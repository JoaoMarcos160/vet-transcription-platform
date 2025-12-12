import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TranscriptionWorker } from './transcription.worker';
import { FirebaseAdapter } from '../infrastructure/adapters/firebase/firebase.adapter';
import { AsrAdapter } from '../infrastructure/adapters/asr/asr.adapter';
import { QueueAdapter, TranscriptionJob } from '../infrastructure/adapters/queue/queue.adapter';

/**
 * Testes unitários para TranscriptionWorker
 * Cobre processamento de jobs, integração com ASR e notificações
 */
describe('TranscriptionWorker', () => {
  let worker: TranscriptionWorker;
  let firebaseAdapter: jest.Mocked<FirebaseAdapter>;
  let asrAdapter: jest.Mocked<AsrAdapter>;
  let queueAdapter: jest.Mocked<QueueAdapter>;
  let configService: jest.Mocked<ConfigService>;

  // Mock de job de transcrição
  const mockJob = {
    id: 'job-123',
    data: {
      transcriptionId: 'transcription-123',
      userId: 'user-123',
      audioUrl: 'https://storage.googleapis.com/bucket/audio/...',
      audioFormat: 'mp3',
      durationSeconds: 300,
      audioFileId: 'audio/user-123/file.mp3',
    } as TranscriptionJob,
  };

  // Mock de resultado de transcrição
  const mockTranscriptionResult = {
    text: 'Este é um teste de transcrição. O áudio foi processado com sucesso.',
    segments: [
      {
        startTime: 0,
        endTime: 5,
        text: 'Este é um teste de transcrição.',
        confidence: 0.95,
      },
      {
        startTime: 5,
        endTime: 10,
        text: 'O áudio foi processado com sucesso.',
        confidence: 0.92,
      },
    ],
    confidence: 0.935,
    duration: 10,
    language: 'pt-BR',
    provider: 'google-cloud-speech',
  };

  beforeEach(async () => {
    // Criar mocks dos adapters
    const mockFirebaseAdapterObj = {
      updateTranscription: jest.fn(),
      createNotification: jest.fn(),
      registerTranscriptionProcessor: jest.fn(),
    };

    const mockAsrAdapterObj = {
      transcribe: jest.fn(),
      getSupportedLanguages: jest.fn(),
      getProviderInfo: jest.fn(),
    };

    const mockQueueAdapterObj = {
      registerTranscriptionProcessor: jest.fn(),
      getQueueStats: jest.fn(),
      pauseQueue: jest.fn(),
      resumeQueue: jest.fn(),
      removeJob: jest.fn(),
    };

    const mockConfigServiceObj = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          ASR_LANGUAGE_CODE: 'pt-BR',
          ASR_ENABLE_DIARIZATION: 'false',
          ASR_PROVIDER: 'google-cloud-speech',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptionWorker,
        {
          provide: FirebaseAdapter,
          useValue: mockFirebaseAdapterObj,
        },
        {
          provide: AsrAdapter,
          useValue: mockAsrAdapterObj,
        },
        {
          provide: QueueAdapter,
          useValue: mockQueueAdapterObj,
        },
        {
          provide: ConfigService,
          useValue: mockConfigServiceObj,
        },
      ],
    }).compile();

    worker = module.get<TranscriptionWorker>(TranscriptionWorker);
    firebaseAdapter = module.get(FirebaseAdapter) as jest.Mocked<FirebaseAdapter>;
    asrAdapter = module.get(AsrAdapter) as jest.Mocked<AsrAdapter>;
    queueAdapter = module.get(QueueAdapter) as jest.Mocked<QueueAdapter>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
  });

  describe('processTranscription', () => {
    it('deve processar transcrição com sucesso', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      // Mock do download de arquivo
      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      const result = await worker.processTranscription(mockJob);

      // Assert
      expect(result.status).toBe('completed');
      expect(result.transcriptionId).toBe('transcription-123');
      expect(result.transcriptText).toBe(mockTranscriptionResult.text);
      expect(result.segments).toEqual(mockTranscriptionResult.segments);
      expect(result.confidence).toBe(mockTranscriptionResult.confidence);

      // Verificar que status foi atualizado
      expect(firebaseAdapter.updateTranscription).toHaveBeenCalledWith(
        'transcription-123',
        expect.objectContaining({
          status: 'completed',
          transcriptText: mockTranscriptionResult.text,
        }),
      );

      // Verificar que notificação foi enviada
      expect(firebaseAdapter.createNotification).toHaveBeenCalled();
    });

    it('deve atualizar status para processing no início', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      await worker.processTranscription(mockJob);

      // Assert
      // Primeira chamada deve ser para atualizar para "processing"
      expect(firebaseAdapter.updateTranscription).toHaveBeenNthCalledWith(
        1,
        'transcription-123',
        expect.objectContaining({
          status: 'processing',
        }),
      );
    });

    it('deve tratar erro de download de arquivo', async () => {
      // Arrange
      jest.spyOn(worker as any, 'downloadAudioFile').mockRejectedValue(
        new Error('Erro ao baixar arquivo'),
      );
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      // Act
      const result = await worker.processTranscription(mockJob);

      // Assert
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Erro ao baixar arquivo');

      // Verificar que status foi atualizado para failed
      expect(firebaseAdapter.updateTranscription).toHaveBeenCalledWith(
        'transcription-123',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.any(String),
        }),
      );
    });

    it('deve tratar erro de transcrição ASR', async () => {
      // Arrange
      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );
      asrAdapter.transcribe.mockRejectedValue(
        new Error('Erro na API do Google Cloud Speech'),
      );
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      // Act
      const result = await worker.processTranscription(mockJob);

      // Assert
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Erro na API');
    });

    it('deve calcular tempo de processamento', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      const result = await worker.processTranscription(mockJob);

      // Assert
      expect(result.processingTimeMs).toBeGreaterThan(0);
      expect(typeof result.processingTimeMs).toBe('number');
    });

    it('deve enviar notificação ao usuário em caso de sucesso', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      await worker.processTranscription(mockJob);

      // Assert
      expect(firebaseAdapter.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          transcriptionId: 'transcription-123',
          type: 'transcription_completed',
          title: 'Transcrição Concluída',
        }),
      );
    });

    it('deve enviar notificação ao usuário em caso de falha', async () => {
      // Arrange
      jest.spyOn(worker as any, 'downloadAudioFile').mockRejectedValue(
        new Error('Erro ao baixar'),
      );
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      // Act
      await worker.processTranscription(mockJob);

      // Assert
      expect(firebaseAdapter.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          transcriptionId: 'transcription-123',
          type: 'transcription_failed',
          title: 'Erro na Transcrição',
        }),
      );
    });

    it('deve continuar mesmo se notificação falhar', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockRejectedValue(
        new Error('Erro ao enviar notificação'),
      );

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      const result = await worker.processTranscription(mockJob);

      // Assert
      // Mesmo com erro na notificação, transcrição deve ser marcada como completed
      expect(result.status).toBe('completed');
    });

    it('deve suportar diferentes formatos de áudio', async () => {
      // Arrange
      const formats: Array<'mp3' | 'wav' | 'm4a' | 'opus' | 'ogg' | 'webm'> = [
        'mp3',
        'wav',
        'm4a',
        'opus',
        'ogg',
        'webm',
      ];

      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      for (const format of formats) {
        const jobWithFormat = {
          ...mockJob,
          data: {
            ...mockJob.data,
            audioFormat: format,
          },
        };

        // Act
        const result = await worker.processTranscription(jobWithFormat);

        // Assert
        expect(result.status).toBe('completed');
      }
    });
  });

  describe('getWorkerStats', () => {
    it('deve retornar estatísticas do worker', async () => {
      // Arrange
      queueAdapter.getQueueStats.mockResolvedValue({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 1,
        delayed: 0,
      });

      // Act
      const stats = await worker.getWorkerStats();

      // Assert
      expect(stats.status).toBe('running');
      expect(stats.queueStats).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 1,
        delayed: 0,
      });
      expect(stats.timestamp).toBeInstanceOf(Date);
    });

    it('deve retornar erro se não conseguir obter estatísticas', async () => {
      // Arrange
      queueAdapter.getQueueStats.mockRejectedValue(
        new Error('Erro ao obter stats'),
      );

      // Act
      const stats = await worker.getWorkerStats();

      // Assert
      expect(stats.status).toBe('error');
      expect(stats.error).toBeDefined();
    });
  });

  describe('pauseWorker', () => {
    it('deve pausar o worker', async () => {
      // Arrange
      queueAdapter.pauseQueue.mockResolvedValue(undefined);

      // Act
      await worker.pauseWorker();

      // Assert
      expect(queueAdapter.pauseQueue).toHaveBeenCalled();
    });

    it('deve lançar erro se falhar ao pausar', async () => {
      // Arrange
      queueAdapter.pauseQueue.mockRejectedValue(new Error('Erro ao pausar'));

      // Act & Assert
      await expect(worker.pauseWorker()).rejects.toThrow('Erro ao pausar');
    });
  });

  describe('resumeWorker', () => {
    it('deve retomar o worker', async () => {
      // Arrange
      queueAdapter.resumeQueue.mockResolvedValue(undefined);

      // Act
      await worker.resumeWorker();

      // Assert
      expect(queueAdapter.resumeQueue).toHaveBeenCalled();
    });

    it('deve lançar erro se falhar ao retomar', async () => {
      // Arrange
      queueAdapter.resumeQueue.mockRejectedValue(new Error('Erro ao retomar'));

      // Act & Assert
      await expect(worker.resumeWorker()).rejects.toThrow('Erro ao retomar');
    });
  });

  describe('cancelJob', () => {
    it('deve cancelar um job', async () => {
      // Arrange
      queueAdapter.removeJob.mockResolvedValue(undefined);

      // Act
      await worker.cancelJob('job-123');

      // Assert
      expect(queueAdapter.removeJob).toHaveBeenCalledWith('job-123');
    });

    it('deve lançar erro se falhar ao cancelar', async () => {
      // Arrange
      queueAdapter.removeJob.mockRejectedValue(new Error('Erro ao cancelar'));

      // Act & Assert
      await expect(worker.cancelJob('job-123')).rejects.toThrow(
        'Erro ao cancelar',
      );
    });
  });

  describe('Integração com ASR', () => {
    it('deve chamar ASR com opções corretas', async () => {
      // Arrange
      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      await worker.processTranscription(mockJob);

      // Assert
      expect(asrAdapter.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        'mp3',
        expect.objectContaining({
          languageCode: 'pt-BR',
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
        }),
      );
    });

    it('deve usar diarização se habilitada', async () => {
      // Arrange
      configService.get.mockImplementation((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          ASR_LANGUAGE_CODE: 'pt-BR',
          ASR_ENABLE_DIARIZATION: 'true',
          ASR_PROVIDER: 'google-cloud-speech',
        };
        return config[key] ?? defaultValue;
      });

      asrAdapter.transcribe.mockResolvedValue(mockTranscriptionResult);
      firebaseAdapter.updateTranscription.mockResolvedValue(undefined);
      firebaseAdapter.createNotification.mockResolvedValue(undefined);

      jest.spyOn(worker as any, 'downloadAudioFile').mockResolvedValue(
        Buffer.from('fake audio data'),
      );

      // Act
      await worker.processTranscription(mockJob);

      // Assert
      expect(asrAdapter.transcribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        'mp3',
        expect.objectContaining({
          enableSpeakerDiarization: true,
        }),
      );
    });
  });
});
