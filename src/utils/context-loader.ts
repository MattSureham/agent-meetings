import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { extname, join, basename } from 'node:path';

export interface ContextImage {
  data: string;
  mimeType: string;
  source?: string;
}

export interface ContextPayload {
  text: string;
  images: ContextImage[];
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.log', '.xml', '.toml', '.ini', '.cfg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function isFilePath(input: string): boolean {
  if (input.includes('\n')) return false;
  if (existsSync(input)) return true;
  const ext = extname(input).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext) || ext === '.pdf' || ext === '.docx';
}

async function loadFile(filePath: string): Promise<ContextPayload> {
  const ext = extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    const text = readFileSync(filePath, 'utf-8');
    return { text, images: [] };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const data = readFileSync(filePath);
    const b64 = data.toString('base64');
    return {
      text: '',
      images: [{ data: `data:${mimeType};base64,${b64}`, mimeType, source: basename(filePath) }],
    };
  }

  if (ext === '.pdf') {
    return loadPdf(filePath);
  }

  if (ext === '.docx') {
    return loadDocx(filePath);
  }

  // Unknown extension — try as text
  try {
    const text = readFileSync(filePath, 'utf-8');
    return { text, images: [] };
  } catch {
    throw new Error(`Unsupported file type: ${ext || 'no extension'}`);
  }
}

async function loadDir(dirPath: string): Promise<ContextPayload> {
  const parts: string[] = [];
  const images: ContextImage[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await loadDir(fullPath);
      if (sub.text) parts.push(sub.text);
      images.push(...sub.images);
    } else if (entry.isFile()) {
      try {
        const result = await loadFile(fullPath);
        if (result.text) parts.push(`--- ${entry.name} ---\n${result.text}`);
        images.push(...result.images);
      } catch {
        // skip unreadable files
      }
    }
  }

  return { text: parts.join('\n\n'), images };
}

async function loadPdf(filePath: string): Promise<ContextPayload> {
  const { getDocument } = await import('pdfjs-dist');
  const data = new Uint8Array(readFileSync(filePath));
  const pdfDoc = await getDocument({ data, useWorkerFetch: false }).promise;

  const textParts: string[] = [];
  const images: ContextImage[] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) textParts.push(pageText);

    // Extract embedded images
    try {
      const ops = await page.getOperatorList();
      const pageImages: Map<string, { width: number; height: number }> = new Map();
      for (let j = 0; j < ops.fnArray.length; j++) {
        // OPS.paintImageXObject and friends
        const fn = ops.fnArray[j];
        if (fn === 85 || fn === 82 || fn === 43) {
          const args = ops.argsArray[j];
          if (Array.isArray(args) && args.length > 0) {
            const imgName = String(args[0]);
            if (!pageImages.has(imgName)) {
              pageImages.set(imgName, { width: 0, height: 0 });
            }
          }
        }
      }
      for (const [imgName] of pageImages) {
        try {
          const img = await new Promise<{ data: Uint8Array; width: number; height: number } | null>((resolve) => {
            (page as any).objs.get(imgName, (obj: any) => {
              if (obj?.data) {
                resolve({ data: obj.data as Uint8Array, width: obj.width ?? 0, height: obj.height ?? 0 });
              } else {
                resolve(null);
              }
            });
          });
          if (img?.data && img.data.length > 0) {
            const b64 = Buffer.from(img.data).toString('base64');
            // Detect format from magic bytes
            const mime = detectImageMime(img.data);
            images.push({
              data: `data:${mime};base64,${b64}`,
              mimeType: mime,
              source: `${basename(filePath)}#page${i}-${imgName}`,
            });
          }
        } catch {
          // skip unextractable images
        }
      }
    } catch {
      // image extraction is best-effort
    }
  }

  return { text: textParts.join('\n\n'), images };
}

async function loadDocx(filePath: string): Promise<ContextPayload> {
  const mammoth = await import('mammoth');
  const buf = readFileSync(filePath);
  const images: ContextImage[] = [];

  const result = await mammoth.convertToHtml(
    {
      buffer: buf,
    },
    {
      convertImage: mammoth.images.imgElement((element: { contentType: string; read: () => Promise<Buffer> }) => {
        const mimeType = element.contentType ?? 'image/png';
        return element.read().then((imgBuf) => {
          const b64 = imgBuf.toString('base64');
          images.push({ data: `data:${mimeType};base64,${b64}`, mimeType });
          return { src: `data:${mimeType};base64,${b64}` };
        });
      }),
    }
  );

  // Strip HTML tags for plain text
  const text = result.value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return { text, images };
}

function detectImageMime(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp';
  return 'image/png';
}

export async function loadContextFromData(
  data: Buffer,
  filename: string,
  mimeType?: string
): Promise<ContextPayload> {
  const ext = extname(filename).toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    return { text: data.toString('utf-8'), images: [] };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const mime = mimeType ?? MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const b64 = data.toString('base64');
    return {
      text: '',
      images: [{ data: `data:${mime};base64,${b64}`, mimeType: mime, source: filename }],
    };
  }

  if (ext === '.pdf') {
    return loadPdfFromBuffer(data, filename);
  }

  if (ext === '.docx') {
    return loadDocxFromBuffer(data);
  }

  // Unknown — try as text
  try {
    return { text: data.toString('utf-8'), images: [] };
  } catch {
    throw new Error(`Unsupported file type: ${ext || 'no extension'}`);
  }
}

async function loadPdfFromBuffer(data: Buffer, source: string): Promise<ContextPayload> {
  const { getDocument } = await import('pdfjs-dist');
  const pdfDoc = await getDocument({ data: new Uint8Array(data), useWorkerFetch: false }).promise;

  const textParts: string[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) textParts.push(pageText);
  }

  return { text: textParts.join('\n\n'), images: [] };
}

async function loadDocxFromBuffer(buf: Buffer): Promise<ContextPayload> {
  const mammoth = await import('mammoth');
  const images: ContextImage[] = [];

  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement((element: { contentType: string; read: () => Promise<Buffer> }) => {
        const mimeType = element.contentType ?? 'image/png';
        return element.read().then((imgBuf) => {
          const b64 = imgBuf.toString('base64');
          images.push({ data: `data:${mimeType};base64,${b64}`, mimeType });
          return { src: `data:${mimeType};base64,${b64}` };
        });
      }),
    }
  );

  const text = result.value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return { text, images };
}

const DATA_URI_RE = /data:([^;]+);base64,([A-Za-z0-9+/=]+)/g;

export async function parseInlineContext(raw: string): Promise<ContextPayload> {
  const images: ContextImage[] = [];
  let text = raw;
  const dataUris: Array<{ mime: string; data: Buffer }> = [];

  for (const match of raw.matchAll(DATA_URI_RE)) {
    const mime = match[1];
    const b64 = match[2];
    try {
      const data = Buffer.from(b64, 'base64');
      if (mime.startsWith('image/')) {
        images.push({ data: match[0], mimeType: mime });
        text = text.replace(match[0], `[Image: ${mime}]`);
      } else if (mime === 'application/pdf' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        dataUris.push({ mime, data });
        text = text.replace(match[0], '');
      }
    } catch {
      // skip malformed base64
    }
  }

  // Process document data URIs
  for (const { mime, data } of dataUris) {
    try {
      const ext = mime === 'application/pdf' ? '.pdf' : '.docx';
      const result = await loadContextFromData(data, `upload${ext}`, mime);
      if (result.text) text = (text + '\n\n' + result.text).trim();
      images.push(...result.images);
    } catch {
      // skip unprocessable documents
    }
  }

  return { text: text.trim(), images };
}

export async function loadContext(source: string): Promise<ContextPayload> {
  const trimmed = source.trim();
  if (!trimmed) return { text: '', images: [] };

  if (isFilePath(trimmed)) {
    const stat = statSync(trimmed);
    if (stat.isDirectory()) {
      return loadDir(trimmed);
    }
    return loadFile(trimmed);
  }

  return { text: trimmed, images: [] };
}

export function loadContextSync(source: string): ContextPayload {
  // For sync callers — detect if it's a simple text/image file, defer complex
  // formats to the async path. Returns best-effort sync result.
  const trimmed = source.trim();
  if (!trimmed) return { text: '', images: [] };

  if (!isFilePath(trimmed)) return { text: trimmed, images: [] };

  const stat = statSync(trimmed);
  if (stat.isDirectory()) {
    // Directory needs recursion — return a placeholder, caller should use async
    const entries = readdirSync(trimmed, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
    return {
      text: `Directory: ${trimmed}\nFiles: ${files.join(', ')}\n(Use async loading for full context extraction)`,
      images: [],
    };
  }

  const ext = extname(trimmed).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return { text: readFileSync(trimmed, 'utf-8'), images: [] };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const data = readFileSync(trimmed);
    const b64 = data.toString('base64');
    return {
      text: '',
      images: [{ data: `data:${mimeType};base64,${b64}`, mimeType, source: basename(trimmed) }],
    };
  }

  // PDF, DOCX, dir — need async
  return {
    text: `File: ${basename(trimmed)} (use async loading for full context extraction)`,
    images: [],
  };
}
