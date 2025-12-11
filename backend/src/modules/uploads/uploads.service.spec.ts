import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadsService } from './uploads.service';
import { FirebaseAdapter } from '../../infrastructure/adapters/firebase/firebase.adapter';
import { QueueAdapter } from '../../infrastructure/adapters/queue/queue.adapter';

/**
 * Testes unitários para UploadsService
 * Cobre validação de arquivo, upload, enfileiramento e tratamento de erros
 */
describe('UploadsService', () => {
  let service: UploadsService;
  let firebaseAdapter: jest.Mocked<FirebaseAdapter>;
  let queueAdapter: jest.Mocked<QueueAdapter>;
  let configService: jest.Mocked<ConfigService>;

  // Mock do arquivo de áudio
  const mockAudioFile: Express.Multer.File = {
    fieldname: 'audio',
    originalname: 'test-audio.mp3',
    encoding: '7bit',
    mimetype: 'audio/mpeg',
    size: 5242880, // 5 MB
    destination: '/tmp',
    filename: 'test-audio.mp3',
    path: '/tmp/test-audio.mp3',
    buffer: Buffer.from('fake audio data'),
  };

  // Mock de transcrição criada
  const mockTranscription = {
    id: 'transcription-123',
    userId: 'user-123',
    audioFileId: 'audio/user-123/1702200000000-abc123-test-audio.mp3',
    audioUrl: 'https://storage.googleapis.com/bucket/audio/user-123/...',
    audioFormat: 'mp3',
    durationSeconds: 300,
    status: 'pending',
    transcriptText: '',
    segments: [],
    confidence: 0,
    provider: 'google-cloud-speech',
    isPurchased: false,
    purchasePrice: 10,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    // Criar mocks dos adapters
    const mockFirebaseAdapter = {
      uploadFile: jest.fn(),
      createTranscription: jest.fn(),
      getTranscription: jest.fn(),
      deleteFile: jest.fn(),
      deleteTranscription: jest.fn(),
      getUserTranscriptions: jest.fn(),
    };

    const mockQueueAdapter = {
      enqueueTranscriptionJob: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          MAX_AUDIO_DURATION: '1800',
          MAX_FILE_SIZE: '314572800',
          ASR_PROVIDER: 'google-cloud-speech',
          PRICE_PER_MINUTE: '2',
          REDIS_HOST: 'localhost',
          REDIS_PORT: '6379',
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: FirebaseAdapter,
          useValue: mockFirebaseAdapter,
        },
        {
          provide: QueueAdapter,
          useValue: mockQueueAdapter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    firebaseAdapter = module.get(FirebaseAdapter) as jest.Mocked<FirebaseAdapter>;
    queueAdapter = module.get(QueueAdapter) as jest.Mocked<QueueAdapter>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;
  });

  describe('uploadAudio', () => {
    it('deve fazer upload de áudio com sucesso', async () => {
      // Arrange
      const userId = 'user-123';
      firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
      firebaseAdapter.createTranscription.mockResolvedValue(mockTranscription);
      queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

      // Act
      const result = await service.uploadAudio(userId, mockAudioFile);

      // Assert
      expect(result).toEqual({
        transcriptionId: mockTranscription.id,
        audioFileId: expect.any(String),
        audioUrl: mockTranscription.audioUrl,
        status: 'pending',
        message: expect.stringContaining('Áudio enviado com sucesso'),
        estimatedProcessingTime: expect.any(String),
      });

      expect(firebaseAdapter.uploadFile).toHaveBeenCalled();
      expect(firebaseAdapter.createTranscription).toHaveBeenCalled();
      expect(queueAdapter.enqueueTranscriptionJob).toHaveBeenCalled();
    });

    it('deve rejeitar arquivo sem MIME type válido', async () => {
      // Arrange
      const userId = 'user-123';
      const invalidFile = {
        ...mockAudioFile,
        mimetype: 'video/mp4',
      };

      // Act & Assert
      await expect(service.uploadAudio(userId, invalidFile)).rejects.toThrow(
        BadRequestException,
      );
      expect(firebaseAdapter.uploadFile).not.toHaveBeenCalled();
    });

    it('deve rejeitar arquivo muito grande', async () => {
      // Arrange
      const userId = 'user-123';
      const largeFile = {
        ...mockAudioFile,
        size: 400000000, // 400 MB (acima do limite de 300 MB)
      };

      // Act & Assert
      await expect(service.uploadAudio(userId, largeFile)).rejects.toThrow(
        BadRequestException,
      );
      expect(firebaseAdapter.uploadFile).not.toHaveBeenCalled();
    });

    it('deve rejeitar arquivo com extensão inválida', async () => {
      // Arrange
      const userId = 'user-123';
      const invalidExtensionFile = {
        ...mockAudioFile,
        originalname: 'test-audio.txt',
        mimetype: 'audio/mpeg',
      };

      // Act & Assert
      await expect(service.uploadAudio(userId, invalidExtensionFile)).rejects.toThrow(
        BadRequestException,
      );
      expect(firebaseAdapter.uploadFile).not.toHaveBeenCalled();
    });

    it('deve rejeitar arquivo nulo', async () => {
      // Arrange
      const userId = 'user-123';

      // Act & Assert
      await expect(service.uploadAudio(userId, null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve rejeitar áudio com duração acima do limite', async () => {
      // Arrange
      const userId = 'user-123';
      // Arquivo com tamanho que indica duração > 30 minutos
      const longAudioFile = {
        ...mockAudioFile,
        size: 400000000, // Indicaria ~6.6 horas de áudio
      };

      // Act & Assert
      await expect(service.uploadAudio(userId, longAudioFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deve lançar InternalServerErrorException em caso de erro no Firebase', async () => {
      // Arrange
      const userId = 'user-123';
      firebaseAdapter.uploadFile.mockRejectedValue(
        new Error('Firebase connection error'),
      );

      // Act & Assert
      await expect(service.uploadAudio(userId, mockAudioFile)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('deve calcular preço correto baseado na duração', async () => {
      // Arrange
      const userId = 'user-123';
      firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
      firebaseAdapter.createTranscription.mockImplementation((data) => {
        return Promise.resolve({
          ...mockTranscription,
          purchasePrice: data.purchasePrice,
        });
      });
      queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

      // Act
      const result = await service.uploadAudio(userId, mockAudioFile);

      // Assert
      // 300 segundos = 5 minutos = 10 centavos (5 * 2)
      expect(firebaseAdapter.createTranscription).toHaveBeenCalledWith(
        expect.objectContaining({
          purchasePrice: 10,
        }),
      );
    });

    it('deve suportar múltiplos formatos de áudio', async () => {
      // Arrange
      const userId = 'user-123';
      const formats = [
        { mimetype: 'audio/mpeg', name: 'test.mp3' },
        { mimetype: 'audio/wav', name: 'test.wav' },
        { mimetype: 'audio/mp4', name: 'test.m4a' },
        { mimetype: 'audio/ogg', name: 'test.ogg' },
      ];

      for (const format of formats) {
        firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
        firebaseAdapter.createTranscription.mockResolvedValue(mockTranscription);
        queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

        const file = {
          ...mockAudioFile,
          mimetype: format.mimetype,
          originalname: format.name,
        };

        // Act
        const result = await service.uploadAudio(userId, file);

        // Assert
        expect(result.status).toBe('pending');
      }
    });
  });

  describe('getTranscriptionStatus', () => {
    it('deve retornar status de transcrição existente', async () => {
      // Arrange
      const transcriptionId = 'transcription-123';
      firebaseAdapter.getTranscription.mockResolvedValue(mockTranscription);

      // Act
      const result = await service.getTranscriptionStatus(transcriptionId);

      // Assert
      expect(result).toEqual({
        id: mockTranscription.id,
        status: mockTranscription.status,
        transcriptText: mockTranscription.transcriptText,
        confidence: mockTranscription.confidence,
        createdAt: mockTranscription.createdAt,
        completedAt: undefined,
        errorMessage: undefined,
      });
    });

    it('deve lançar erro para transcrição não encontrada', async () => {
      // Arrange
      const transcriptionId = 'non-existent';
      firebaseAdapter.getTranscription.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getTranscriptionStatus(transcriptionId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listUserTranscriptions', () => {
    it('deve listar transcrições do usuário', async () => {
      // Arrange
      const userId = 'user-123';
      const mockTranscriptions = [mockTranscription, mockTranscription];
      firebaseAdapter.getUserTranscriptions.mockResolvedValue(mockTranscriptions);

      // Act
      const result = await service.listUserTranscriptions(userId, 10, 0);

      // Assert
      expect(result).toEqual({
        data: mockTranscriptions,
        total: 2,
        limit: 10,
        offset: 0,
      });
      expect(firebaseAdapter.getUserTranscriptions).toHaveBeenCalledWith(userId, 10);
    });

    it('deve retornar lista vazia se usuário não tem transcrições', async () => {
      // Arrange
      const userId = 'user-without-transcriptions';
      firebaseAdapter.getUserTranscriptions.mockResolvedValue([]);

      // Act
      const result = await service.listUserTranscriptions(userId);

      // Assert
      expect(result.total).toBe(0);
      expect(result.data).toEqual([]);
    });
  });

  describe('deleteTranscription', () => {
    it('deve deletar transcrição do proprietário', async () => {
      // Arrange
      const transcriptionId = 'transcription-123';
      const userId = 'user-123';
      firebaseAdapter.getTranscription.mockResolvedValue(mockTranscription);
      firebaseAdapter.deleteFile.mockResolvedValue(undefined);
      firebaseAdapter.deleteTranscription.mockResolvedValue(undefined);

      // Act
      await service.deleteTranscription(transcriptionId, userId);

      // Assert
      expect(firebaseAdapter.deleteFile).toHaveBeenCalledWith(
        mockTranscription.audioFileId,
      );
      expect(firebaseAdapter.deleteTranscription).toHaveBeenCalledWith(
        transcriptionId,
      );
    });

    it('deve rejeitar deleção por usuário não proprietário', async () => {
      // Arrange
      const transcriptionId = 'transcription-123';
      const userId = 'other-user';
      firebaseAdapter.getTranscription.mockResolvedValue(mockTranscription);

      // Act & Assert
      await expect(
        service.deleteTranscription(transcriptionId, userId),
      ).rejects.toThrow(BadRequestException);
      expect(firebaseAdapter.deleteFile).not.toHaveBeenCalled();
    });

    it('deve rejeitar deleção de transcrição não encontrada', async () => {
      // Arrange
      const transcriptionId = 'non-existent';
      const userId = 'user-123';
      firebaseAdapter.getTranscription.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.deleteTranscription(transcriptionId, userId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUploadConfig', () => {
    it('deve retornar configuração de upload', () => {
      // Act
      const config = service.getUploadConfig();

      // Assert
      expect(config).toEqual({
        maxDurationSeconds: 1800,
        maxFileSizeBytes: 314572800,
        allowedMimeTypes: expect.arrayContaining(['audio/mpeg', 'audio/wav']),
        allowedFormats: expect.arrayContaining(['mp3', 'wav', 'm4a']),
      });
    });
  });

  describe('Validação de arquivo', () => {
    it('deve aceitar arquivo MP3', async () => {
      // Arrange
      const userId = 'user-123';
      const mp3File = {
        ...mockAudioFile,
        originalname: 'audio.mp3',
        mimetype: 'audio/mpeg',
      };
      firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
      firebaseAdapter.createTranscription.mockResolvedValue(mockTranscription);
      queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

      // Act
      const result = await service.uploadAudio(userId, mp3File);

      // Assert
      expect(result.status).toBe('pending');
    });

    it('deve aceitar arquivo WAV', async () => {
      // Arrange
      const userId = 'user-123';
      const wavFile = {
        ...mockAudioFile,
        originalname: 'audio.wav',
        mimetype: 'audio/wav',
      };
      firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
      firebaseAdapter.createTranscription.mockResolvedValue(mockTranscription);
      queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

      // Act
      const result = await service.uploadAudio(userId, wavFile);

      // Assert
      expect(result.status).toBe('pending');
    });

    it('deve aceitar arquivo M4A', async () => {
      // Arrange
      const userId = 'user-123';
      const m4aFile = {
        ...mockAudioFile,
        originalname: 'audio.m4a',
        mimetype: 'audio/mp4',
      };
      firebaseAdapter.uploadFile.mockResolvedValue(mockTranscription.audioUrl);
      firebaseAdapter.createTranscription.mockResolvedValue(mockTranscription);
      queueAdapter.enqueueTranscriptionJob.mockResolvedValue('job-123');

      // Act
      const result = await service.uploadAudio(userId, m4aFile);

      // Assert
      expect(result.status).toBe('pending');
    });
  });
});
