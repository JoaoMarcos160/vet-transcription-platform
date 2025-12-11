import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';

/**
 * Controller para gerenciar uploads de áudio
 * Endpoints:
 * - POST /uploads - Upload de novo arquivo de áudio
 * - GET /uploads/:id - Status de transcrição
 * - GET /uploads - Listar transcrições do usuário
 * - DELETE /uploads/:id - Deletar transcrição
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  /**
   * Faz upload de arquivo de áudio
   * Valida formato, duração e tamanho
   * Enfileira job de transcrição
   *
   * @param file - Arquivo de áudio (multipart/form-data)
   * @param req - Request com usuário autenticado
   * @returns UploadResponse com ID da transcrição
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: {
        fileSize: 314572800, // 300 MB
      },
      fileFilter: (req, file, callback) => {
        const allowedMimes = [
          'audio/mpeg',
          'audio/wav',
          'audio/mp4',
          'audio/ogg',
          'audio/webm',
        ];

        if (!allowedMimes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Formato de áudio não suportado: ${file.mimetype}`,
            ),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadAudio(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi fornecido');
    }

    const userId = req.user.sub; // Firebase UID do token JWT

    return this.uploadsService.uploadAudio(userId, file);
  }

  /**
   * Obtém status de uma transcrição
   *
   * @param id - ID da transcrição
   * @param req - Request com usuário autenticado
   * @returns Status da transcrição
   */
  @Get(':id')
  async getTranscriptionStatus(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    // TODO: Validar que o usuário é proprietário da transcrição
    return this.uploadsService.getTranscriptionStatus(id);
  }

  /**
   * Lista transcrições do usuário com paginação
   *
   * @param req - Request com usuário autenticado
   * @param limit - Número máximo de resultados (padrão: 10)
   * @param offset - Número de resultados a pular (padrão: 0)
   * @returns Array de transcrições do usuário
   */
  @Get()
  async listUserTranscriptions(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user.sub;
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    return this.uploadsService.listUserTranscriptions(
      userId,
      parsedLimit,
      parsedOffset,
    );
  }

  /**
   * Deleta uma transcrição e seu arquivo de áudio
   *
   * @param id - ID da transcrição
   * @param req - Request com usuário autenticado
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTranscription(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const userId = req.user.sub;
    await this.uploadsService.deleteTranscription(id, userId);
  }

  /**
   * Obtém configuração de upload (limites, formatos aceitos)
   * Útil para frontend saber as restrições
   *
   * @returns UploadConfig com limites e formatos
   */
  @Get('config')
  getUploadConfig() {
    return this.uploadsService.getUploadConfig();
  }
}
