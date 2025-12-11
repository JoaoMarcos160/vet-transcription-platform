# Veterinary Transcription Platform

Uma plataforma escalável para transcrição de áudio e geração de prontuários médicos veterinários estruturados, com suporte a pagamentos via Stripe e integração com IA (GPT-4).

## 🎯 Visão Geral

A **Plataforma de Transcrição de Prontuários Veterinários** permite que profissionais veterinários:

- Gravem ou façam upload de áudio em vários formatos (MP3, WAV, M4A, Opus)
- Transcrever automaticamente usando provedores ASR (Google Cloud Speech, Azure, etc.)
- Editar e revisar transcrições
- Comprar acesso a transcrições via Stripe
- Gerar prontuários médicos estruturados em JSON e PDF
- Acessar documentos via links embarcáveis com TTL curto

## 🏗️ Arquitetura

```
Frontend (React + TypeScript)
         ↓
NestJS API Gateway (Auth, Uploads, Transcriptions, Payments)
         ↓
┌─────────────────────────────────────────┐
│ Firebase (Auth, Firestore, Storage)     │
│ Redis + BullMQ (Job Queue)              │
│ Stripe (Payments)                       │
│ OpenAI GPT-4 (AI Transformation)        │
└─────────────────────────────────────────┘
         ↓
Workers (Transcription, Document Generation)
```

## 📁 Estrutura do Projeto

```
vet-transcription-platform/
├── backend/                 # NestJS API
│   ├── src/
│   │   ├── common/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── modules/
│   ├── test/
│   ├── Dockerfile
│   └── package.json
├── frontend/                # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.tsx
│   ├── public/
│   └── package.json
├── workers/                 # Background Jobs
│   ├── transcription.worker.ts
│   ├── document-generator.worker.ts
│   ├── Dockerfile
│   └── package.json
├── infra/                   # Kubernetes & Terraform
│   ├── kubernetes/
│   ├── terraform/
│   └── docker-compose.yml
├── .github/
│   └── workflows/           # CI/CD Pipelines
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── SECURITY.md
└── README.md
```

## 🚀 Quick Start

### Pré-requisitos

- Node.js 18+
- Docker & Docker Compose
- Firebase Project
- Stripe Account
- OpenAI API Key

### Instalação Local

```bash
# Clone o repositório
git clone https://github.com/JoaoMarcos160/vet-transcription-platform.git
cd vet-transcription-platform

# Instale dependências
npm install

# Configure variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Inicie com Docker Compose
npm run docker:up

# Acesse a aplicação
# Frontend: http://localhost:3000
# API: http://localhost:3001
```

## 🔧 Desenvolvimento

```bash
# Inicie todos os serviços em desenvolvimento
npm run dev

# Execute testes
npm run test

# Execute linter
npm run lint

# Build para produção
npm run build
```

## 📚 Documentação

- [Arquitetura Detalhada](./docs/ARCHITECTURE.md)
- [Especificação da API](./docs/API.md)
- [Guia de Segurança](./docs/SECURITY.md)
- [Deployment](./docs/DEPLOYMENT.md)

## 🔐 Segurança

- ✅ OAuth2 Google Sign-In
- ✅ JWT Authentication
- ✅ Firestore Security Rules (isolamento por usuário)
- ✅ Firebase Storage Security Rules
- ✅ Stripe Webhook Signature Verification
- ✅ Rate Limiting
- ✅ Encrypted Sensitive Data

## 💳 Pagamentos

Integração completa com Stripe:
- Checkout sessions
- Webhook handling
- Invoices & Receipts
- Refunds

## 🤖 IA & Transformação

Usa OpenAI GPT-4 para transformar transcrições em:
- JSON estruturado conforme schema médico veterinário
- Relatório formatado em português

## 📊 Observabilidade

- Prometheus metrics
- Grafana dashboards
- Centralized logging
- Error tracking

## 🐳 Docker & Kubernetes

```bash
# Build images
npm run docker:build

# Deploy to Kubernetes
kubectl apply -f infra/kubernetes/

# Monitor
kubectl logs -f deployment/vet-transcription-api
```

## 🚢 Deployment

### Opções:

1. **Firebase (Recomendado para MVP)**
   - Cloud Functions para API
   - Firestore para dados
   - Cloud Storage para arquivos
   - Cloud Tasks para filas

2. **AWS (Para escala empresarial)**
   - ECS/Fargate para containers
   - RDS/DynamoDB para dados
   - S3 para storage
   - SQS/SNS para mensageria

Ver [DEPLOYMENT.md](./docs/DEPLOYMENT.md) para detalhes.

## 📈 Roadmap

- [ ] Suporte a múltiplos idiomas
- [ ] Diarização de falantes
- [ ] Integração com EMR veterinários populares
- [ ] Mobile app nativa
- [ ] Análise de prontuários com IA
- [ ] Integração com laboratórios

## 🤝 Contribuindo

Veja [CONTRIBUTING.md](./CONTRIBUTING.md) para diretrizes.

## 📄 Licença

MIT License - veja [LICENSE](./LICENSE) para detalhes.

## 📞 Suporte

- Issues: https://github.com/JoaoMarcos160/vet-transcription-platform/issues
- Email: support@vet-transcription.local

---

**Desenvolvido com ❤️ para a comunidade veterinária**
