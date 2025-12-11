import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TranscriptionsService } from './transcriptions.service';

@Controller('transcriptions')
@UseGuards(JwtAuthGuard)
export class TranscriptionsController {
  constructor(private transcriptionsService: TranscriptionsService) {}

  @Get(':id')
  async getTranscription(@Param('id') id: string, @Req() req: any) {
    return this.transcriptionsService.getTranscription(id);
  }

  @Post(':id/purchase')
  async purchaseTranscription(@Param('id') id: string, @Req() req: any) {
    return this.transcriptionsService.createCheckoutSession(id, req.user.id);
  }
}
