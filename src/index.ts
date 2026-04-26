/**
 * Agent Meetings - A framework for technical meetings between AI agents and LLMs
 */

export { Agent, AgentConfig } from './agent.js';
export { AgentMeeting, MeetingConfig, Message, Participant } from './meeting.js';
export { MeetingProtocol, ProtocolMessage } from './protocol.js';
export * as LLM from './llm/adapters.js';
