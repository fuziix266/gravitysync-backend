import { getUserRoom } from './server.js';
import { saveMessage, getMessages, getMessagesSince, getSessions } from '../db/messages.js';
import config from '../config.js';
import log from '../utils/logger.js';

/**
 * Registrar handlers de Socket.IO (patrón Mattermost: event-driven messaging).
 * 
 * Flujo:
 *   Agente → save_message → DB (dedup UUID) → si nuevo + tipo visible → new_message → Flutter
 *   Flutter → send_command → DB (tipo 'user') → relay agent_execute → Agente
 *   Flutter → sync → getMessagesSince(lastSeq) → sync_response → Flutter
 */
export function registerHandlers(io) {
    io.on('connection', (socket) => {
        const room = getUserRoom(socket.email);
        socket.join(room);
        log.ws(`${socket.id} conectado (${socket.email}) → ${room}`);

        // ═══════════════════════════════════════════════════════════
        // AGENTE → SERVER: guardar mensaje con dedup UUID
        // ═══════════════════════════════════════════════════════════
        socket.on('save_message', async (data) => {
            const { uuid, sessionId, sectionType, text, html, hasCode, buttons } = data;

            if (!uuid || !sessionId || !text) {
                log.warn('save_message rechazado: faltan campos');
                return;
            }

            const result = await saveMessage(uuid, sessionId, sectionType, text, hasCode, buttons, html || '');

            if (result.isNew) {
                log.info(`[NEW] ${sectionType} seq=${result.seq} para ${sessionId.substring(0, 8)}...`);

                // FILTRADO SERVER-SIDE (patrón Mattermost): solo pushear tipos visibles
                if (config.pushableTypes.has(sectionType)) {
                    socket.to(room).emit('new_message', {
                        sessionId,
                        message: {
                            id: result.id,
                            seq: result.seq,
                            uuid,
                            sectionType,
                            text,
                            html: html || '',
                            hasCode: hasCode || false,
                            buttons: buttons || [],
                            timestamp: new Date().toISOString(),
                        },
                    });
                }
            }
            // Duplicado → silencio (idempotente, patrón WhatsApp/Mattermost)
        });

        // ═══════════════════════════════════════════════════════════
        // FLUTTER → SERVER: enviar comando al agente
        // ═══════════════════════════════════════════════════════════
        socket.on('send_command', async (data) => {
            const { sessionId, command } = data;
            if (!sessionId || !command) return;

            log.info(`[MOBILE→AGENT] ${socket.email}: ${command.substring(0, 50)}...`);

            // Guardar como mensaje tipo 'user'
            const uuid = `user:${sessionId}:${Date.now()}`;
            const result = await saveMessage(uuid, sessionId, 'user', command, false, []);

            // Push a Flutter (el propio emisor ve su mensaje con seq)
            if (result.isNew) {
                socket.emit('message_saved', {
                    sessionId,
                    message: {
                        id: result.id,
                        seq: result.seq,
                        uuid,
                        sectionType: 'user',
                        text: command,
                        hasCode: false,
                        buttons: [],
                        timestamp: new Date().toISOString(),
                    },
                });
            }

            // Relay al agente local
            socket.to(room).emit('agent_execute', {
                command,
                sessionId,
                timestamp: new Date().toISOString(),
            });
        });

        // ═══════════════════════════════════════════════════════════
        // FLUTTER → SERVER: sync por sequence number (patrón Mattermost)
        // ═══════════════════════════════════════════════════════════
        socket.on('sync', async (data) => {
            const { sessionId, lastSeq = 0, includeThinking = false } = data;
            if (!sessionId) return;

            const result = await getMessagesSince(sessionId, lastSeq, { includeThinking });

            socket.emit('sync_response', {
                sessionId,
                messages: result.messages,
                lastSeq: result.lastSeq,
            });
        });

        // ═══════════════════════════════════════════════════════════
        // FLUTTER → SERVER: historial paginado (REST-like via WS)
        // ═══════════════════════════════════════════════════════════
        socket.on('request_chat_history', async (data) => {
            const { sessionId, offset = 0, limit = 15, includeThinking = false } = data;
            if (!sessionId) return;

            const result = await getMessages(sessionId, { limit, offset, includeThinking });

            socket.emit('chat_history_response', {
                sessionId,
                messages: result.messages,
                total: result.total,
                hasMore: result.hasMore,
                offset,
                status: result.messages.length > 0 ? 'ok' : 'empty',
            });
        });

        // ═══════════════════════════════════════════════════════════
        // TYPING INDICATOR (simplificado: 1 evento bidireccional)
        // ═══════════════════════════════════════════════════════════
        socket.on('agent_typing', (data) => {
            socket.to(room).emit('agent_typing', data);
        });

        // Legacy aliases (compatibilidad con agente local actual)
        socket.on('agent_working', (data) => {
            socket.to(room).emit('agent_typing', { ...data, status: 'working' });
        });
        socket.on('agent_idle', (data) => {
            socket.to(room).emit('agent_typing', { ...data, status: 'idle' });
        });

        // ═══════════════════════════════════════════════════════════
        // STREAMING: Agente envía texto parcial (turno activo)
        // ═══════════════════════════════════════════════════════════
        socket.on('message_update', (data) => {
            const { sectionType } = data;
            // Solo reenviar tipos visibles (NO thinking/status)
            if (config.pushableTypes.has(sectionType)) {
                socket.to(room).emit('message_update', data);
            }
        });

        // ═══════════════════════════════════════════════════════════
        // STOP: Flutter pide detener generación al agente
        // ═══════════════════════════════════════════════════════════
        socket.on('stop_generation', (data) => {
            log.info(`[STOP] ${socket.email} solicita detener generación`);
            socket.to(room).emit('stop_generation', data);
        });

        // ═══════════════════════════════════════════════════════════
        // SESIONES: relay del agente para Flutter
        // ═══════════════════════════════════════════════════════════
        socket.on('update_sessions', (data) => {
            socket.to(room).emit('sessions_list', data);
        });

        // ═══════════════════════════════════════════════════════════
        // FLUTTER → SERVER: solicitar sesiones desde BD (on-connect pull)
        // ═══════════════════════════════════════════════════════════
        socket.on('request_sessions', async () => {
            log.info(`[SESSIONS] ${socket.email} solicita sesiones activas`);
            // Relay al agente local → el agente re-escanea CDP y emite update_sessions
            socket.to(room).emit('request_sessions', {
                timestamp: new Date().toISOString(),
            });
        });

        // ═══════════════════════════════════════════════════════════
        // LEGACY RELAYS (compatibilidad con agente local actual)
        // ═══════════════════════════════════════════════════════════
        socket.on('mobile_command', async (data) => {
            // Redirect al nuevo handler
            const { sessionId, command } = data;
            if (sessionId && command) {
                const uuid = `user:${sessionId}:${Date.now()}`;
                const result = await saveMessage(uuid, sessionId, 'user', command, false, []);
                if (result.isNew) {
                    socket.emit('message_saved', {
                        sessionId,
                        message: {
                            id: result.id, seq: result.seq, uuid,
                            sectionType: 'user', text: command,
                            hasCode: false, buttons: [],
                            timestamp: new Date().toISOString(),
                        },
                    });
                }
            }
            socket.to(room).emit('agent_execute', data);
        });

        socket.on('request_chat', (data) => socket.to(room).emit('request_chat', data));
        socket.on('chat_messages', (data) => socket.to(room).emit('chat_messages', data));
        socket.on('request_actions', (data) => socket.to(room).emit('request_actions', data));
        socket.on('available_actions', (data) => socket.to(room).emit('available_actions', data));
        socket.on('remote_action', (data) => socket.to(room).emit('remote_action', data));
        socket.on('action_result', (data) => socket.to(room).emit('action_result', data));

        // ═══════════════════════════════════════════════════════════
        socket.on('disconnect', () => {
            log.ws(`${socket.id} desconectado`);
        });
    });
}
