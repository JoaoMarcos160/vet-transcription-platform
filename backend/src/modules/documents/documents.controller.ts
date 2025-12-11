import { Controller, Post, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post(':transcriptionId/generate')
  async generateMedicalRecord(
    @Param('transcriptionId') transcriptionId: string,
    @Req() req: any,
  ) {
    return this.documentsService.generateMedicalRecord(transcriptionId, req.user.id);
  }
}
