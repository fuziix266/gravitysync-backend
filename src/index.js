import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import config from './config.js';
import log from './utils/logger.js';
import { initDB } from './db/init.js';
import { createWSServer } from './ws/server.js';
import { registerHandlers } from './ws/handlers.js';
import apiRoutes from './api/routes.js';

// ═══════════════════════════════════════════════════════════════════
// GravitySync Backend v2.0 — Mattermost-inspired architecture
// ═══════════════════════════════════════════════════════════════════

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// REST API
app.use(apiRoutes);

// WebSocket
const io = createWSServer(httpServer);
registerHandlers(io);

// Iniciar
async function start() {
    try {
        // 1. Inicializar BD (auto-create tables)
        await initDB();

        // 2. Iniciar servidor HTTP + WebSocket
        httpServer.listen(config.port, () => {
            log.info(`🚀 GravitySync Backend v2.0 en puerto ${config.port}`);
            log.info(`   WebSocket: ws://localhost:${config.port}`);
            log.info(`   REST API:  http://localhost:${config.port}/api/`);
            log.info(`   Env: ${config.nodeEnv}`);
        });
    } catch (e) {
        log.error('Error fatal al iniciar:', e.message);
        process.exit(1);
    }
}

start();
