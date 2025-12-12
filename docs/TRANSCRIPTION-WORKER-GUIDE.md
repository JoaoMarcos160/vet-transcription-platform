# Guia de Implementação: Transcription Worker

**Data**: Dezembro 10, 2024  
**Status**: ✅ Implementado  
**Arquivo Principal**: `backend/src/workers/transcription.worker.ts`

---

## 📋 Visão Geral

O **Transcription Worker** é um serviço de background que processa jobs de transcrição enfileirados pela plataforma. Ele é responsável por consumir jobs da fila Redis, baixar arquivos de áudio do Firebase Storage, integrar com Google Cloud Speech-to-Text para transcrição, salvar resultados em Firestore e notificar usuários sobre conclusão ou erros.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│ UploadsService (Enfileira job)                          │
│ POST /uploads → enqueueTranscriptionJob()               │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│ Redis Queue (BullMQ)                                    │
│ Fila de jobs aguardando processamento                   │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│ TranscriptionWorker                                     │
│ 1. Consome job da fila                                  │
│ 2. Baixa áudio do Firebase Storage                      │
│ 3. Chama Google Cloud Speech-to-Text                    │
│ 4. Salva transcrição em Firestore                       │
│ 5. Notifica usuário                                     │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│ Firestore        │  │ Notificações     │
│ - Transcrição    │  │ - WebSocket      │
│ - Segmentos      │  │ - Email          │
│ - Confiança      │  │ - Push Notif     │
└──────────────────┘  └──────────────────┘
```

---

## 📦 Componentes Implementados

### 1. **transcription.worker.ts** (350+ linhas)

Serviço principal que processa jobs de transcrição.

#### Métodos Principais

| Método | Descrição | Retorno |
|--------|-----------|---------|
| `processTranscription(job)` | Processa um job de transcrição | `TranscriptionJobResult` |
| `getWorkerStats()` | Obtém estatísticas do worker | `WorkerStats` |
| `pauseWorker()` | Pausa processamento de jobs | `void` |
| `resumeWorker()` | Retoma processamento de jobs | `void` |
| `cancelJob(jobId)` | Cancela um job específico | `void` |

#### Fluxo de Processamento

```
1. Receber job da fila
   ├─ transcriptionId
   ├─ userId
   ├─ audioUrl
   ├─ audioFormat
   └─ durationSeconds

2. Atualizar status para "processing"
   └─ Salvar em Firestore

3. Baixar áudio do Firebase Storage
   ├─ Fazer requisição HTTP/HTTPS
   ├─ Acumular chunks em buffer
   └─ Timeout de 5 minutos

4. Chamar Google Cloud Speech-to-Text
   ├─ Enviar buffer de áudio
   ├─ Configurar opções (idioma, diarização, etc)
   └─ Receber transcrição com segmentos

5. Processar resultado
   ├─ Extrair texto completo
   ├─ Extrair segmentos com timestamps
   └─ Calcular confiança média

6. Salvar em Firestore
   ├─ Status: "completed"
   ├─ Transcrição completa
   ├─ Segmentos com timestamps
   └─ Confiança

7. Notificar usuário
   ├─ Criar notificação
   ├─ Enviar via WebSocket/Email
   └─ Salvar em Firestore

8. Retornar resultado
   └─ { status, transcriptionId, confidence, processingTimeMs }
```

### 2. **asr.adapter.ts** (350+ linhas)

Adapter que abstrai diferentes provedores de Speech-to-Text.

#### Funcionalidades

- ✅ **Suporte a Google Cloud Speech-to-Text**: Integração completa
- ✅ **Abstração de Provedor**: Permite trocar de ASR sem alterar worker
- ✅ **Múltiplos Formatos**: MP3, WAV, M4A, Opus, OGG, WebM
- ✅ **Extração de Segmentos**: Timestamps e confiança por segmento
- ✅ **Opções Configuráveis**: Idioma, diarização, pontuação automática
- ✅ **Tratamento de Erro**: Mensagens claras e logging

#### Métodos Principais

| Método | Descrição |
|--------|-----------|
| `transcribe(buffer, format, options)` | Transcreve áudio |
| `getSupportedLanguages()` | Lista idiomas suportados |
| `getProviderInfo()` | Informações do provedor |

#### Idiomas Suportados

O adapter suporta os seguintes idiomas:

| Idioma | Código | Exemplo |
|--------|--------|---------|
| Português (Brasil) | `pt-BR` | 🇧🇷 Padrão |
| Português (Portugal) | `pt-PT` | 🇵🇹 Europeu |
| Inglês (EUA) | `en-US` | 🇺🇸 Americano |
| Inglês (Reino Unido) | `en-GB` | 🇬🇧 Britânico |
| Espanhol (Espanha) | `es-ES` | 🇪🇸 Europeu |
| Espanhol (México) | `es-MX` | 🇲🇽 Mexicano |
| Francês | `fr-FR` | 🇫🇷 |
| Alemão | `de-DE` | 🇩🇪 |
| Italiano | `it-IT` | 🇮🇹 |
| Japonês | `ja-JP` | 🇯🇵 |
| Chinês (Simplificado) | `zh-CN` | 🇨🇳 |
| Chinês (Tradicional) | `zh-TW` | 🇹🇼 |
| Coreano | `ko-KR` | 🇰🇷 |
| Russo | `ru-RU` | 🇷🇺 |

### 3. **transcription.worker.spec.ts** (400+ linhas)

Suite completa de testes unitários com 25+ casos de teste.

#### Cobertura de Testes

- ✅ Processamento bem-sucedido de transcrição
- ✅ Atualização de status para "processing"
- ✅ Erro ao baixar arquivo
- ✅ Erro na API do ASR
- ✅ Cálculo de tempo de processamento
- ✅ Notificação ao usuário em sucesso
- ✅ Notificação ao usuário em falha
- ✅ Continuação mesmo com erro de notificação
- ✅ Suporte a múltiplos formatos de áudio
- ✅ Integração com ASR
- ✅ Diarização de falantes
- ✅ Pausar/retomar worker
- ✅ Cancelar jobs

---

## 🔧 Configuração

### Variáveis de Ambiente

Adicione as seguintes variáveis ao arquivo `.env`:

```bash
# ASR (Automatic Speech Recognition)
ASR_PROVIDER=google-cloud-speech           # Provedor (google-cloud-speech, azure-speech)
ASR_LANGUAGE_CODE=pt-BR                    # Idioma padrão
ASR_ENABLE_DIARIZATION=false               # Habilitar identificação de falantes
ASR_ENABLE_PUNCTUATION=true                # Habilitar pontuação automática

# Google Cloud Speech-to-Text
GOOGLE_CLOUD_CREDENTIALS=                  # JSON com credenciais (opcional)
GOOGLE_CLOUD_PROJECT_ID=seu-projeto        # ID do projeto GCP

# Redis (Fila de jobs)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                            # Opcional

# Worker
WORKER_CONCURRENCY=5                       # Número de jobs processados em paralelo
WORKER_LOCK_DURATION=30000                 # Lock de 30 segundos
WORKER_LOCK_RENEW_TIME=15000               # Renovar lock a cada 15 segundos

# Firebase
FIREBASE_PROJECT_ID=seu-projeto
FIREBASE_PRIVATE_KEY=sua-chave-privada
FIREBASE_CLIENT_EMAIL=seu-email
FIREBASE_STORAGE_BUCKET=seu-bucket
```

### Instalação de Dependências

```bash
cd backend
npm install

# Dependências necessárias:
# - @google-cloud/speech
# - @nestjs/common
# - @nestjs/config
# - firebase-admin
# - bullmq
# - ioredis
```

### Configurar Google Cloud Speech-to-Text

#### 1. Criar Projeto GCP

```bash
# Criar novo projeto
gcloud projects create vet-transcription-prod

# Definir como projeto padrão
gcloud config set project vet-transcription-prod
```

#### 2. Habilitar API

```bash
# Habilitar Cloud Speech-to-Text API
gcloud services enable speech.googleapis.com
```

#### 3. Criar Service Account

```bash
# Criar service account
gcloud iam service-accounts create vet-transcription-worker \
  --display-name="Vet Transcription Worker"

# Conceder permissões
gcloud projects add-iam-policy-binding vet-transcription-prod \
  --member="serviceAccount:vet-transcription-worker@vet-transcription-prod.iam.gserviceaccount.com" \
  --role="roles/speech.client"

# Gerar chave JSON
gcloud iam service-accounts keys create credentials.json \
  --iam-account=vet-transcription-worker@vet-transcription-prod.iam.gserviceaccount.com
```

#### 4. Configurar Credenciais

```bash
# Copiar conteúdo de credentials.json
cat credentials.json

# Adicionar ao .env como GOOGLE_CLOUD_CREDENTIALS (sem quebras de linha)
GOOGLE_CLOUD_CREDENTIALS='{"type":"service_account","project_id":"..."}'
```

---

## 💻 Exemplos de Uso

### Iniciar Worker

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TranscriptionWorker } from './workers/transcription.worker';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Inicializar worker
  const worker = app.get(TranscriptionWorker);
  console.log('Transcription Worker iniciado');

  await app.listen(3001);
}

bootstrap();
```

### Monitorar Estatísticas

```typescript
// stats.controller.ts
import { Controller, Get } from '@nestjs/common';
import { TranscriptionWorker } from '../workers/transcription.worker';

@Controller('admin/worker')
export class WorkerStatsController {
  constructor(private worker: TranscriptionWorker) {}

  @Get('stats')
  async getStats() {
    return this.worker.getWorkerStats();
  }

  @Get('pause')
  async pauseWorker() {
    await this.worker.pauseWorker();
    return { message: 'Worker pausado' };
  }

  @Get('resume')
  async resumeWorker() {
    await this.worker.resumeWorker();
    return { message: 'Worker retomado' };
  }
}
```

### Cancelar Transcrição

```typescript
// transcriptions.service.ts
import { Injectable } from '@nestjs/common';
import { TranscriptionWorker } from '../workers/transcription.worker';

@Injectable()
export class TranscriptionsService {
  constructor(private worker: TranscriptionWorker) {}

  async cancelTranscription(jobId: string) {
    await this.worker.cancelJob(jobId);
    // Atualizar status em Firestore
    return { message: 'Transcrição cancelada' };
  }
}
```

---

## 🧪 Executar Testes

```bash
cd backend

# Todos os testes
npm run test

# Apenas transcription worker
npm run test -- transcription.worker.spec

# Com coverage
npm run test:cov

# Em modo watch
npm run test -- --watch
```

---

## 📊 Monitoramento

### Logs

O worker registra eventos importantes:

```
[TranscriptionWorker] Iniciando processamento de transcrição: transcription-123
[TranscriptionWorker] Baixando áudio: audio/user-123/file.mp3
[TranscriptionWorker] Chamando ASR provider: mp3
[TranscriptionWorker] Transcrição concluída: Este é um teste...
[TranscriptionWorker] Transcrição transcription-123 processada com sucesso em 45230ms
```

### Métricas

Monitorar as seguintes métricas:

| Métrica | Descrição | Alerta |
|---------|-----------|--------|
| `queue.waiting` | Jobs aguardando | > 100 |
| `queue.active` | Jobs sendo processados | > 10 |
| `queue.failed` | Jobs falhados | > 5 |
| `processing_time_ms` | Tempo médio de processamento | > 120000 |
| `asr_error_rate` | Taxa de erro da API ASR | > 5% |

### Prometheus Metrics (Futuro)

```typescript
// Exemplo de métricas Prometheus
const processingDuration = new Histogram({
  name: 'transcription_processing_duration_ms',
  help: 'Tempo de processamento de transcrição',
  buckets: [1000, 5000, 10000, 30000, 60000],
});

const asrErrors = new Counter({
  name: 'asr_errors_total',
  help: 'Total de erros da API ASR',
});
```

---

## 🔐 Segurança

### Autenticação Google Cloud

- ✅ Service Account com credenciais JSON
- ✅ Permissões mínimas (apenas `speech.client`)
- ✅ Credenciais em variáveis de ambiente (não em código)

### Validação de Dados

- ✅ Validação de formato de áudio
- ✅ Validação de tamanho de arquivo
- ✅ Timeout de download (5 minutos)
- ✅ Tratamento de erro em todas as etapas

### Isolamento de Dados

- ✅ Cada usuário acessa apenas suas transcrições
- ✅ Firebase Storage Rules por userId
- ✅ Firestore Security Rules por ownership

---

## 🚀 Performance

### Otimizações Implementadas

| Otimização | Descrição | Impacto |
|------------|-----------|--------|
| **Workers Paralelos** | Até 5 jobs simultâneos | 5x mais rápido |
| **Priorização de Jobs** | Jobs curtos primeiro | Melhor UX |
| **Retry Automático** | 3 tentativas com backoff | Maior confiabilidade |
| **Timeout de Download** | 5 minutos máximo | Evita travamento |
| **Modelo Melhorado** | `latest_long` do Google | Melhor precisão |

### Tempo de Processamento Esperado

| Duração de Áudio | Tempo de Processamento | Velocidade |
|------------------|----------------------|-----------|
| 5 minutos | ~30 segundos | 10x |
| 15 minutos | ~1 minuto | 15x |
| 30 minutos | ~2 minutos | 15x |

---

## 🔄 Escalabilidade

### Horizontal Scaling

```bash
# Iniciar múltiplos workers
docker-compose up -d --scale worker=5

# Cada worker processa jobs em paralelo
# Redis distribui jobs entre workers automaticamente
```

### Vertical Scaling

```bash
# Aumentar concorrência por worker
WORKER_CONCURRENCY=10
```

### Monitoramento de Fila

```bash
# Verificar status da fila
redis-cli

> LLEN transcriptions:jobs
(integer) 42

> LLEN transcriptions:active
(integer) 5
```

---

## 🐛 Troubleshooting

### Erro: "Google Cloud credentials not found"

**Solução**: Verificar variável `GOOGLE_CLOUD_CREDENTIALS`

```bash
# Verificar se está configurada
echo $GOOGLE_CLOUD_CREDENTIALS

# Se não estiver, adicionar ao .env
GOOGLE_CLOUD_CREDENTIALS='{"type":"service_account",...}'
```

### Erro: "Timeout ao baixar arquivo"

**Solução**: Arquivo de áudio muito grande ou conexão lenta

```bash
# Aumentar timeout (em ms)
# No transcription.worker.ts, linha ~150
request.setTimeout(600000, () => { // 10 minutos
```

### Erro: "Unsupported audio format"

**Solução**: Formato de áudio não suportado

```bash
# Formatos suportados:
# mp3, wav, m4a, opus, ogg, webm

# Converter para formato suportado
ffmpeg -i input.flac -c:a libmp3lame -q:a 4 output.mp3
```

### Worker não processa jobs

**Solução**: Verificar se Redis está rodando

```bash
# Verificar status do Redis
redis-cli ping

# Se não responder, iniciar Redis
docker-compose up -d redis
```

---

## 📚 Próximos Passos

### Fase 4: Document Generator Worker

Implementar worker que:
- Obtém transcrição do Firestore
- Chama OpenAI GPT-4 para extrair dados estruturados
- Renderiza template Handlebars
- Gera PDF
- Salva em Firebase Storage

### Fase 5: Integração com Stripe

Implementar sistema de pagamento:
- Criar checkout sessions
- Validar webhooks
- Atualizar status de pagamento
- Desbloquear transcrições pagas

### Fase 6: Notificações em Tempo Real

Implementar diferentes canais:
- WebSocket para notificações instantâneas
- Email para notificações assíncronas
- Push notifications para mobile
- In-app notifications

---

## 📞 Suporte

Para dúvidas ou problemas:

1. Consulte os logs em `backend/logs/`
2. Revise a documentação em `docs/ARCHITECTURE.md`
3. Execute os testes: `npm run test -- transcription.worker.spec`
4. Abra uma issue no GitHub
5. Verifique a configuração de Google Cloud

---

## 📄 Referências

- [Google Cloud Speech-to-Text Documentation](https://cloud.google.com/speech-to-text/docs)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [NestJS Microservices](https://docs.nestjs.com/microservices/basics)
- [Firebase Admin SDK](https://firebase.google.com/docs/database/admin/start)

---

**Última atualização**: Dezembro 10, 2024  
**Próxima fase**: Document Generator Worker
