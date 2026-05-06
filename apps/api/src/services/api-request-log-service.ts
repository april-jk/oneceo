import { apiRequestLogDAO, type NewApiRequestLog } from '../db/dao/api-request-log.dao';

export class ApiRequestLogService {
  async append(data: Partial<NewApiRequestLog> & { appUserId: string; method: string; path: string }) {
    try {
      return await apiRequestLogDAO.create(data);
    } catch (error) {
      console.warn('[api-request-log-service] append failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async list(options: {
    userId?: string;
    method?: string;
    path?: string;
    status?: number;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    return apiRequestLogDAO.list(options);
  }

  async getDetail(id: string) {
    return apiRequestLogDAO.findById(id);
  }
}

export const apiRequestLogService = new ApiRequestLogService();
