import { Router } from 'express';
import { getMessages, getMessagesSince, getSessions } from '../db/messages.js';
import log from '../utils/logger.js';

const router = Router();

// Health check
router.get('/', (req, res) => {
    res.json({
        name: 'GravitySync Backend',
        version: '2.0.0',
        status: 'running',
        architecture: 'Mattermost-inspired',
    });
});

// GET /api/messages/:sessionId — historial paginado
router.get('/api/messages/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 15;
    const offset = parseInt(req.query.offset) || 0;
    const includeThinking = req.query.includeThinking === 'true';

    const result = await getMessages(sessionId, { limit, offset, includeThinking });
    log.api(`GET /messages/${sessionId.substring(0, 8)}... → ${result.messages.length} msgs`);

    res.json(result);
});

// GET /api/messages/:sessionId/since/:seq — sync por sequence (patrón Mattermost)
router.get('/api/messages/:sessionId/since/:seq', async (req, res) => {
    const { sessionId, seq } = req.params;
    const includeThinking = req.query.includeThinking === 'true';

    const result = await getMessagesSince(sessionId, parseInt(seq), { includeThinking });
    log.api(`GET /messages/${sessionId.substring(0, 8)}../since/${seq} → ${result.messages.length} msgs`);

    res.json(result);
});

// GET /api/sessions — lista de sesiones con último mensaje
router.get('/api/sessions', async (req, res) => {
    const sessions = await getSessions();
    log.api(`GET /sessions → ${sessions.length} sesiones`);
    res.json({ sessions });
});

export default router;
