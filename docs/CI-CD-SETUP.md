# Configuração de CI/CD com GitHub Actions

## 📋 Visão Geral

Este documento descreve como configurar o pipeline CI/CD para a Plataforma de Transcrição de Prontuários Veterinários usando GitHub Actions.

---

## 1. Pré-requisitos

- Repositório GitHub criado ✅
- Conta Firebase (para deploy dev)
- Conta AWS (para deploy prod)
- Secrets configurados no GitHub

---

## 2. Configurar Secrets no GitHub

### 2.1 Acessar Settings → Secrets and variables → Actions

```
https://github.com/JoaoMarcos160/vet-transcription-platform/settings/secrets/actions
```

### 2.2 Adicionar os seguintes secrets:

#### Firebase Secrets (para deploy em develop)
```
FIREBASE_TOKEN
  → Obter com: firebase login:ci
  → Salvar token gerado

FIREBASE_PROJECT_ID
  → ID do projeto Firebase

FIREBASE_PRIVATE_KEY
  → Chave privada do Firebase Service Account (JSON)

FIREBASE_CLIENT_EMAIL
  → Email do Firebase Service Account
```

#### AWS Secrets (para deploy em main)
```
AWS_ACCESS_KEY_ID
  → Access Key da conta AWS

AWS_SECRET_ACCESS_KEY
  → Secret Access Key da conta AWS

AWS_REGION
  → Região padrão (ex: us-east-1)
```

#### Stripe Secrets
```
STRIPE_SECRET_KEY
  → Chave secreta do Stripe

STRIPE_WEBHOOK_SECRET
  → Secret do webhook do Stripe
```

#### OpenAI Secrets
```
OPENAI_API_KEY
  → Chave da API OpenAI
```

#### Slack Notifications (opcional)
```
SLACK_WEBHOOK
  → URL do webhook do Slack para notificações
```

---

## 3. Criar GitHub Actions Workflow

### 3.1 Criar arquivo de workflow

```bash
mkdir -p .github/workflows
touch .github/workflows/ci-cd.yml
```

### 3.2 Adicionar conteúdo do workflow

Veja o arquivo `.github/workflows/ci-cd.yml` no repositório.

---

## 4. Estrutura do Pipeline

```
┌─────────────────────────────────────────────────────────┐
│ GitHub Push (main ou develop)                           │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
   ┌─────────────┐      ┌──────────────┐
   │ Lint & Test │      │ Security Scan│
   │  (Backend)  │      │  (Trivy)     │
   └──────┬──────┘      └──────┬───────┘
          │                    │
          └──────────┬─────────┘
                     │
                     ▼
            ┌────────────────┐
            │ Build Docker   │
            │ Image          │
            └────────┬───────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   ┌──────────────┐         ┌──────────────┐
   │ Deploy to    │         │ Deploy to    │
   │ Firebase Dev │         │ AWS Prod     │
   │ (develop)    │         │ (main)       │
   └──────────────┘         └──────────────┘
        │                         │
        └────────────┬────────────┘
                     │
                     ▼
            ┌────────────────┐
            │ Slack Notify   │
            │ (Success/Fail) │
            └────────────────┘
```

---

## 5. Fluxo de Desenvolvimento

### 5.1 Desenvolvimento Local

```bash
# 1. Criar branch de feature
git checkout -b feature/nova-funcionalidade

# 2. Fazer alterações
# ... editar código ...

# 3. Testar localmente
npm run test
npm run lint

# 4. Commit
git commit -m "feat: descrição da funcionalidade"

# 5. Push para feature branch
git push origin feature/nova-funcionalidade
```

### 5.2 Pull Request → Staging (develop)

```bash
# 1. Criar Pull Request para develop
# GitHub Actions roda:
#   - Lint
#   - Tests
#   - Build Docker Image
#   - Push para GitHub Container Registry

# 2. Revisar e aprovar PR

# 3. Merge para develop
# GitHub Actions roda:
#   - Todos os testes novamente
#   - Deploy para Firebase (staging)
#   - Notifica Slack
```

### 5.3 Release → Produção (main)

```bash
# 1. Criar PR de develop → main
# GitHub Actions roda:
#   - Lint e Tests
#   - Build Docker Image
#   - Security Scan (Trivy)

# 2. Revisar e aprovar

# 3. Merge para main
# GitHub Actions roda:
#   - Deploy para AWS (produção)
#   - Notifica Slack
```

---

## 6. Configurar Ambientes

### 6.1 Arquivo .env para Firebase (develop)

```bash
# .env.firebase
FIREBASE_PROJECT_ID=vet-transcription-dev
FIREBASE_STORAGE_BUCKET=vet-transcription-dev.appspot.com
STRIPE_SECRET_KEY=sk_test_...
OPENAI_API_KEY=sk-test-...
```

### 6.2 Arquivo .env para AWS (main)

```bash
# .env.aws
AWS_REGION=us-east-1
RDS_ENDPOINT=vet-transcription-db.xxxxx.rds.amazonaws.com
STRIPE_SECRET_KEY=sk_live_...
OPENAI_API_KEY=sk-...
```

---

## 7. Monitorar Pipeline

### 7.1 Acessar Actions

```
https://github.com/JoaoMarcos160/vet-transcription-platform/actions
```

### 7.2 Visualizar Logs

```bash
# Ou via CLI
gh run list
gh run view <run-id> --log
```

---

## 8. Troubleshooting

### Erro: "refusing to allow a GitHub App to create or update workflow"

**Solução:** O token não tem permissão de workflows. Gerar novo token com permissão:

```bash
gh auth refresh --scopes workflow
```

### Erro: "Firebase token expired"

**Solução:** Regenerar token:

```bash
firebase login:ci
# Copiar novo token para FIREBASE_TOKEN secret
```

### Erro: "AWS credentials not found"

**Solução:** Verificar se AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY estão configurados corretamente:

```bash
# No GitHub Settings → Secrets
# Verificar que os valores não têm espaços extras
```

---

## 9. Adicionar Badges ao README

```markdown
[![CI/CD Pipeline](https://github.com/JoaoMarcos160/vet-transcription-platform/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/JoaoMarcos160/vet-transcription-platform/actions)
```

---

## 10. Próximos Passos

- [ ] Configurar todos os secrets no GitHub
- [ ] Adicionar workflow CI/CD
- [ ] Testar com push para develop
- [ ] Testar com push para main
- [ ] Configurar notificações Slack
- [ ] Adicionar badges ao README
- [ ] Documentar processo de release

---

## 11. Referências

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Firebase CLI Reference](https://firebase.google.com/docs/cli)
- [AWS CLI Reference](https://docs.aws.amazon.com/cli/)
- [Docker Build and Push Action](https://github.com/docker/build-push-action)
