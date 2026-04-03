import type { OneceoApiConnector } from '../connectors/oneceo-api-connector';

export class OsacReleaseManagementService {
  constructor(private readonly oneceoApi: OneceoApiConnector) {}

  listReleases(filters?: { status?: string; query?: string; channel?: string }) {
    return this.oneceoApi.listOsacReleases(filters);
  }

  getRelease(releaseId: string) {
    return this.oneceoApi.getOsacRelease(releaseId);
  }

  uploadRelease(input: {
    version: string;
    fileBase64: string;
    releaseNotes?: string;
    sourceCommit?: string;
    uploadedBy?: string;
    channel?: string;
  }) {
    return this.oneceoApi.uploadOsacRelease(input);
  }

  validateRelease(releaseId: string) {
    return this.oneceoApi.validateOsacRelease(releaseId);
  }

  publishRelease(releaseId: string, publishedBy?: string) {
    return this.oneceoApi.publishOsacRelease(releaseId, publishedBy);
  }

  rollbackRelease(releaseId: string, publishedBy?: string) {
    return this.oneceoApi.rollbackOsacRelease(releaseId, publishedBy);
  }
}
