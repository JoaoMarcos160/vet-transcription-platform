import { Injectable } from '@nestjs/common';

@Injectable()
export class DocumentsService {
  async generateMedicalRecord(transcriptionId: string, userId: string) {
    // TODO: Implement medical record generation
    return { message: 'Document generation stub' };
  }
}
