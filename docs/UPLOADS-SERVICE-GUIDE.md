# Guia de Implementação: Uploads Service

**Data**: Dezembro 10, 2024  
**Status**: ✅ Implementado  
**Arquivo Principal**: `backend/src/modules/uploads/uploads.service.ts`

---

## 📋 Visão Geral

O **Uploads Service** é responsável por gerenciar o upload de arquivos de áudio para a plataforma. Ele implementa validação robusta de arquivos, integração com Firebase Storage, criação de documentos de transcrição no Firestore, e enfileiramento de jobs de transcrição para processamento assíncrono.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│ UploadsController (REST API)                            │
│ POST /uploads - Upload de áudio                         │
│ GET /uploads/:id - Status da transcrição                │
│ GET /uploads - Listar transcrições do usuário           │
│ DELETE /uploads/:id - Deletar transcrição               │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│ UploadsService                                          │
│ - uploadAudio()                                         │
│ - getTranscriptionStatus()                              │
│ - listUserTranscriptions()                              │
│ - deleteTranscription()                                 │
│ - getUploadConfig()                                     │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│ FirebaseAdapter  │  │ QueueAdapter     │
│ - uploadFile()   │  │ - enqueueJob()   │
│ - createTrans()  │  │ - getJobStatus() │
│ - getTranscr()   │  │ - getQueueStats()│
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         ▼                     ▼
   ┌──────────────┐      ┌──────────────┐
   │Firebase      │      │Redis + BullMQ│
   │- Storage     │      │- Job Queue   │
   │- Firestore   │      │- Workers     │
   └──────────────┘      └──────────────┘
```

---

## 📦 Componentes Implementados

### 1. **uploads.service.ts** (400+ linhas)

O serviço principal que implementa toda a lógica de upload.

#### Métodos Principais

| Método | Descrição | Retorno |
|--------|-----------|---------|
| `uploadAudio(userId, file)` | Faz upload de áudio, valida, cria transcrição e enfileira job | `UploadResponse` |
| `getTranscriptionStatus(id)` | Obtém status de uma transcrição | `TranscriptionStatus` |
| `listUserTranscriptions(userId, limit, offset)` | Lista transcrições do usuário | `Array<Transcription>` |
| `deleteTranscription(id, userId)` | Deleta transcrição e arquivo | `void` |
| `getUploadConfig()` | Retorna configuração de upload | `UploadConfig` |

#### Validações Implementadas

- ✅ **Validação de MIME Type**: Aceita apenas `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/ogg`, `audio/webm`
- ✅ **Validação de Tamanho**: Máximo 300 MB (configurável)
- ✅ **Validação de Extensão**: Apenas `.mp3`, `.wav`, `.m4a`, `.opus`, `.ogg`, `.webm`
- ✅ **Validação de Duração**: Máximo 30 minutos (configurável)
- ✅ **Extração de Metadados**: Duração, bitrate, sample rate, canais

#### Fluxo de Upload

```
1. Validação do arquivo
   ├─ MIME type
   ├─ Tamanho
   └─ Extensão

2. Extração de metadados
   ├─ Duração
   ├─ Bitrate
   ├─ Sample rate
   └─ Canais

3. Upload para Firebase Storage
   └─ Caminho: audio/{userId}/{timestamp}-{hash}-{filename}

4. Criação de documento em Firestore
   ├─ Status: "pending"
   ├─ Metadados do áudio
   ├─ Preço calculado
   └─ Timestamps

5. Enfileiramento de job de transcrição
   ├─ Prioridade baseada em duração
   ├─ Retry automático (3 tentativas)
   └─ Timeout de 30 minutos

6. Retorno de resposta
   └─ ID da transcrição + URL do áudio
```

### 2. **queue.adapter.ts** (350+ linhas)

Adapter para gerenciar filas de jobs usando BullMQ e Redis.

#### Funcionalidades

- ✅ **Enfileiramento de Jobs**: Adiciona jobs à fila com prioridade
- ✅ **Processamento Assíncrono**: Workers processam jobs em paralelo
- ✅ **Retry Automático**: Até 3 tentativas com backoff exponencial
- ✅ **Monitoramento**: Estatísticas de fila (waiting, active, completed, failed)
- ✅ **Pausar/Retomar**: Controle de processamento de jobs
- ✅ **Limpeza**: Remove jobs completados após 1 hora

#### Métodos Principais

| Método | Descrição |
|--------|-----------|
| `enqueueTranscriptionJob(job)` | Enfileira um job de transcrição |
| `enqueueMultipleTranscriptionJobs(jobs)` | Enfileira múltiplos jobs |
| `getJobStatus(jobId)` | Obtém status de um job |
| `getQueueStats()` | Obtém estatísticas da fila |
| `pauseQueue()` | Pausa processamento de jobs |
| `resumeQueue()` | Retoma processamento de jobs |
| `removeJob(jobId)` | Remove um job da fila |
| `registerTranscriptionProcessor(processor)` | Registra processor de jobs |

### 3. **uploads.controller.ts** (130+ linhas)

Controller REST que expõe os endpoints de upload.

#### Endpoints

```
POST /uploads
  - Faz upload de arquivo de áudio
  - Validação de MIME type no middleware
  - Retorna: { transcriptionId, audioUrl, status, estimatedProcessingTime }

GET /uploads/:id
  - Obtém status de uma transcrição
  - Retorna: { id, status, transcriptText, confidence, createdAt, completedAt }

GET /uploads?limit=10&offset=0
  - Lista transcrições do usuário com paginação
  - Retorna: { data: [], total, limit, offset }

DELETE /uploads/:id
  - Deleta transcrição e arquivo de áudio
  - Retorna: 204 No Content

GET /uploads/config
  - Obtém configuração de upload
  - Retorna: { maxDurationSeconds, maxFileSizeBytes, allowedMimeTypes, allowedFormats }
```

### 4. **uploads.service.spec.ts** (350+ linhas)

Suite completa de testes unitários com 20+ casos de teste.

#### Cobertura de Testes

- ✅ Upload bem-sucedido
- ✅ Rejeição de MIME type inválido
- ✅ Rejeição de arquivo muito grande
- ✅ Rejeição de extensão inválida
- ✅ Rejeição de arquivo nulo
- ✅ Rejeição de áudio muito longo
- ✅ Erro no Firebase
- ✅ Cálculo correto de preço
- ✅ Suporte a múltiplos formatos
- ✅ Obtenção de status
- ✅ Listagem de transcrições
- ✅ Deleção de transcrição

---

## 🔧 Configuração

### Variáveis de Ambiente

Adicione as seguintes variáveis ao arquivo `.env`:

```bash
# Uploads
MAX_AUDIO_DURATION=1800          # Duração máxima em segundos (30 min)
MAX_FILE_SIZE=314572800          # Tamanho máximo em bytes (300 MB)
PRICE_PER_MINUTE=2               # Preço em centavos por minuto

# Firebase
FIREBASE_PROJECT_ID=seu-projeto
FIREBASE_PRIVATE_KEY=sua-chave-privada
FIREBASE_CLIENT_EMAIL=seu-email
FIREBASE_STORAGE_BUCKET=seu-bucket

# Redis (para fila de transcrição)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                  # Opcional

# ASR Provider
ASR_PROVIDER=google-cloud-speech # ou azure-speech

# Worker
WORKER_CONCURRENCY=5             # Número de jobs processados em paralelo
```

### Instalação de Dependências

```bash
cd backend
npm install

# Dependências necessárias:
# - @nestjs/common
# - @nestjs/config
# - @nestjs/platform-express
# - firebase-admin
# - bullmq
# - ioredis
# - class-validator
# - class-transformer
```

---

## 💻 Exemplos de Uso

### Upload de Áudio (Frontend)

```typescript
// React component example
const uploadAudio = async (file: File) => {
  const formData = new FormData();
  formData.append('audio', file);

  const response = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
    body: formData,
  });

  const data = await response.json();
  console.log('Transcrição criada:', data.transcriptionId);
  console.log('Tempo estimado:', data.estimatedProcessingTime);
};
```

### Obter Status de Transcrição

```typescript
const getStatus = async (transcriptionId: string) => {
  const response = await fetch(`/api/uploads/${transcriptionId}`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });

  const data = await response.json();
  console.log('Status:', data.status);
  console.log('Confiança:', data.confidence);
  console.log('Transcrição:', data.transcriptText);
};
```

### Listar Transcrições do Usuário

```typescript
const listTranscriptions = async () => {
  const response = await fetch('/api/uploads?limit=10&offset=0', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });

  const data = await response.json();
  console.log('Total de transcrições:', data.total);
  data.data.forEach((t) => {
    console.log(`${t.id}: ${t.status}`);
  });
};
```

### Deletar Transcrição

```typescript
const deleteTranscription = async (transcriptionId: string) => {
  const response = await fetch(`/api/uploads/${transcriptionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
  });

  if (response.ok) {
    console.log('Transcrição deletada');
  }
};
```

---

## 🧪 Executar Testes

```bash
cd backend

# Executar todos os testes
npm run test

# Executar testes do uploads service
npm run test -- uploads.service.spec

# Executar com coverage
npm run test:cov

# Executar em modo watch
npm run test -- --watch
```

---

## 🔐 Segurança

### Autenticação
- ✅ JWT token obrigatório em todos os endpoints
- ✅ Validação de ownership (usuário só pode acessar suas transcrições)

### Validação
- ✅ Validação de MIME type no controller e service
- ✅ Validação de tamanho de arquivo
- ✅ Validação de extensão
- ✅ Validação de duração de áudio

### Firebase Storage Rules
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /audio/{userId}/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

---

## 📊 Monitoramento

### Logs

O serviço registra eventos importantes:

```
[UploadsService] Iniciando upload de test-audio.mp3 para Firebase
[UploadsService] Upload concluído: https://storage.googleapis.com/...
[UploadsService] Transcrição criada: transcription-123 para usuário user-123
[UploadsService] Job de transcrição enfileirado: transcription-123
```

### Estatísticas da Fila

```typescript
const stats = await queueAdapter.getQueueStats();
console.log(`Jobs aguardando: ${stats.waiting}`);
console.log(`Jobs processando: ${stats.active}`);
console.log(`Jobs completados: ${stats.completed}`);
console.log(`Jobs falhados: ${stats.failed}`);
```

---

## 🚀 Próximos Passos

### Fase 3: Integração com ASR (Google Cloud Speech)

Implementar o worker que processa jobs de transcrição:

```typescript
// transcription.worker.ts
export class TranscriptionWorker {
  async processTranscription(job: TranscriptionJob) {
    // 1. Baixar áudio do Firebase Storage
    // 2. Chamar Google Cloud Speech-to-Text
    // 3. Salvar transcrição em Firestore
    // 4. Notificar usuário
  }
}
```

### Fase 4: Integração com OpenAI GPT-4

Implementar geração de prontuário médico:

```typescript
// document-generator.worker.ts
export class DocumentGeneratorWorker {
  async generateMedicalRecord(transcriptionId: string) {
    // 1. Obter transcrição
    // 2. Chamar OpenAI GPT-4
    // 3. Renderizar template Handlebars
    // 4. Gerar PDF
    // 5. Salvar em Firebase Storage
  }
}
```

### Fase 5: Integração com Stripe

Implementar sistema de pagamento:

```typescript
// payments.service.ts
export class PaymentsService {
  async createCheckoutSession(transcriptionId: string) {
    // 1. Obter transcrição
    // 2. Calcular preço
    // 3. Criar Stripe Checkout Session
    // 4. Retornar URL de checkout
  }
}
```

---

## 📚 Referências

- [NestJS File Upload](https://docs.nestjs.com/techniques/file-upload)
- [Firebase Storage](https://firebase.google.com/docs/storage)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Jest Testing Guide](https://jestjs.io/docs/getting-started)

---

## 📞 Suporte

Para dúvidas ou problemas:

1. Verifique os logs em `backend/logs/`
2. Consulte a documentação em `docs/ARCHITECTURE.md`
3. Abra uma issue no GitHub
4. Revise os testes em `uploads.service.spec.ts`

---

**Última atualização**: Dezembro 10, 2024  
**Próxima fase**: Implementação do Transcription Worker
