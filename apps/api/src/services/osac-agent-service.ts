import type { OsacMessage } from '../clients/osac-client';
import { osacConnectionManager } from './osac-connection-manager';
import { auditOsacAction } from '../utils/osac-audit';

export class OsacAgentService {
  async executeCommand(
    sessionId: string,
    input: {
      command: string;
      sessionId?: string;
      continueSession?: boolean;
      options?: Record<string, unknown>;
    }
  ) {
    const message: OsacMessage = {
      type: 'EXECUTE_COMMAND',
      payload: {
        command: input.command,
        sessionId: input.sessionId,
        continueSession: input.continueSession,
        options: input.options || {},
      },
    };

    auditOsacAction('EXECUTE_COMMAND', { sessionId, command: input.command });

    await osacConnectionManager.send(sessionId, message);
    return { status: 'sent' };
  }

  async getSessionList(sessionId: string, input?: { maxCount?: number; format?: string }) {
    const message: OsacMessage = {
      type: 'GET_SESSION_LIST',
      payload: {
        maxCount: input?.maxCount,
        format: input?.format,
      },
    };

    auditOsacAction('GET_SESSION_LIST', { sessionId });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SESSION_LIST_RESPONSE';
    });

    return reply.payload || {};
  }

  async getSessionDetails(sessionId: string, opencodeSessionId: string) {
    const message: OsacMessage = {
      type: 'GET_SESSION_DETAILS',
      payload: {
        sessionId: opencodeSessionId,
      },
    };

    auditOsacAction('GET_SESSION_DETAILS', { sessionId, opencodeSessionId });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SESSION_DETAILS_RESPONSE';
    });

    return reply.payload || {};
  }

  async loadSkill(sessionId: string, input: { skillName: string; skillContent: string; overwrite?: boolean }) {
    const message: OsacMessage = {
      type: 'LOAD_SKILL',
      payload: {
        skillName: input.skillName,
        skillContent: input.skillContent,
        overwrite: input.overwrite ?? false,
      },
    };

    auditOsacAction('LOAD_SKILL', { sessionId, skillName: input.skillName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SKILL_STATUS' && res.payload?.skillName === input.skillName;
    });

    return reply.payload || {};
  }

  async unloadSkill(sessionId: string, skillName: string) {
    const message: OsacMessage = {
      type: 'UNLOAD_SKILL',
      payload: {
        skillName,
      },
    };

    auditOsacAction('UNLOAD_SKILL', { sessionId, skillName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'SKILL_STATUS' && res.payload?.skillName === skillName;
    });

    return reply.payload || {};
  }

  async addMcpServer(
    sessionId: string,
    input: { serverName: string; serverConfig: Record<string, unknown>; overwrite?: boolean }
  ) {
    const message: OsacMessage = {
      type: 'ADD_MCP_SERVER',
      payload: {
        serverName: input.serverName,
        serverConfig: input.serverConfig,
        overwrite: input.overwrite ?? false,
      },
    };

    auditOsacAction('ADD_MCP_SERVER', { sessionId, serverName: input.serverName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'MCP_SERVER_STATUS' && res.payload?.serverName === input.serverName;
    });

    return reply.payload || {};
  }

  async removeMcpServer(sessionId: string, serverName: string) {
    const message: OsacMessage = {
      type: 'REMOVE_MCP_SERVER',
      payload: {
        serverName,
      },
    };

    auditOsacAction('REMOVE_MCP_SERVER', { sessionId, serverName });

    const reply = await osacConnectionManager.request(sessionId, message, (res) => {
      return res.type === 'MCP_SERVER_STATUS' && res.payload?.serverName === serverName;
    });

    return reply.payload || {};
  }

  async initiateUpdate(
    sessionId: string,
    input: { updateType: string; version?: string; downloadUrl?: string; updateCommand?: string }
  ) {
    const message: OsacMessage = {
      type: 'INITIATE_UPDATE',
      payload: {
        updateType: input.updateType,
        version: input.version,
        downloadUrl: input.downloadUrl,
        updateCommand: input.updateCommand,
      },
    };

    auditOsacAction('INITIATE_UPDATE', { sessionId, updateType: input.updateType });

    await osacConnectionManager.send(sessionId, message);
    return { status: 'sent' };
  }

  listMessages(sessionId: string, limit?: number) {
    return osacConnectionManager.listMessages(sessionId, limit);
  }

  async closeConnection(sessionId: string) {
    await osacConnectionManager.close(sessionId);
  }
}

export const osacAgentService = new OsacAgentService();
