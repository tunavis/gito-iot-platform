# IoT Platform Infrastructure Diagram

```mermaid
flowchart TD
  %% Users
  subgraph Users
    U1[Web User (Dashboard)]
    U2[API Client (REST)]
    U3[IoT Device / Simulator]
    U4[Admin/Dev (CLI, Seed, Test)]
  end

  %% Frontend
  subgraph Web
    WEB[Next.js App]
  end

  %% API Layer
  subgraph API
    NGINX[NGINX Reverse Proxy]
    FASTAPI[FastAPI Backend]
    CLI[CLI/Seed Scripts]
  end

  %% Messaging
  subgraph Messaging
    MQTTB[MQTT Broker (Mosquitto)]
    SIM[simulator.py]
    PROC[MQTT Processor]
  end

  %% Data Layer
  subgraph Data
    PG[(PostgreSQL)]
    REDIS[(Redis)]
  end

  %% Monitoring
  subgraph Monitoring
    GRAFANA[Grafana]
  end

  %% CI/CD
  subgraph CI_CD
    GITHUB[GitHub Actions]
    GHCR[GitHub Container Registry]
    DOCKER[Docker Compose]
  end

  %% User Flows
  U1-->|HTTP/HTTPS|WEB
  U2-->|REST API|NGINX
  U4-->|Seed/Test|CLI

  %% Web/API
  WEB-->|API Calls|NGINX
  NGINX-->|/api|FASTAPI
  NGINX-->|/ (static)|WEB

  %% API/DB
  FASTAPI-->|DB Access|PG
  FASTAPI-->|Cache|REDIS
  CLI-->|Seed/Test|PG

  %% Device/MQTT
  U3-->|MQTT Publish|MQTTB
  SIM-->|MQTT Publish|MQTTB
  MQTTB-->|MQTT Subscribe|PROC
  PROC-->|Telemetry Ingest|PG

  %% API/Telemetry
  FASTAPI-->|Telemetry Query|PG
  FASTAPI-->|Device Control|MQTTB

  %% Monitoring
  GRAFANA-->|Dashboards|PG

  %% CI/CD
  GITHUB-->|Build & Push|GHCR
  GHCR-->|Images|DOCKER
  DOCKER-->|Deploys|NGINX
  DOCKER-->|Deploys|FASTAPI
  DOCKER-->|Deploys|WEB
  DOCKER-->|Deploys|MQTTB
  DOCKER-->|Deploys|PROC
  DOCKER-->|Deploys|PG
  DOCKER-->|Deploys|REDIS
  DOCKER-->|Deploys|GRAFANA

  %% Data Flows
  PROC-->|Alert/Notification|FASTAPI
  FASTAPI-->|Notification|REDIS

  %% Optional: External Integrations
  subgraph External
    EXTAPI[External APIs]
    ALERTS[Email/SMS/Push]
  end
  FASTAPI-->|Webhooks|EXTAPI
  FASTAPI-->|Send Alert|ALERTS

  %% Legend
  classDef infra fill:#f9f,stroke:#333,stroke-width:2px;
  classDef data fill:#bbf,stroke:#333,stroke-width:2px;
  classDef messaging fill:#bfb,stroke:#333,stroke-width:2px;
  classDef monitoring fill:#ffd,stroke:#333,stroke-width:2px;
  classDef cicd fill:#eee,stroke:#333,stroke-width:2px;
  class NGINX,FASTAPI,CLI infra;
  class PG,REDIS data;
  class MQTTB,SIM,PROC messaging;
  class GRAFANA monitoring;
  class GITHUB,GHCR,DOCKER cicd;
```
