import pool from './pool.js';
import log from '../utils/logger.js';

/**
 * Guardar mensaje con dedup por UUID (patrón Mattermost: client GUID).
 * ON CONFLICT DO NOTHING → idempotente.
 * Retorna { isNew, seq, id } si insertó, o { isNew: false } si era duplicado.
 */
export async function saveMessage(uuid, sessionId, sectionType, text, hasCode = false, buttons = [], html = '', isVisible = true) {
    try {
        const result = await pool.query(
            `INSERT INTO chat_messages (uuid, session_id, section_type, text, has_code, buttons, html, is_visible)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (uuid) DO NOTHING
             RETURNING id, seq`,
            [uuid, sessionId, sectionType, text, hasCode, JSON.stringify(buttons), html || '', isVisible]
        );

        if (result.rowCount > 0) {
            const { id, seq } = result.rows[0];

            // Actualizar sesión (upsert)
            await pool.query(
                `INSERT INTO chat_sessions (session_id, last_seq, message_count, updated_at)
                 VALUES ($1, $2, 1, NOW())
                 ON CONFLICT (session_id) DO UPDATE SET
                    last_seq = GREATEST(chat_sessions.last_seq, $2),
                    message_count = chat_sessions.message_count + 1,
                    updated_at = NOW()`,
                [sessionId, seq]
            );

            return { isNew: true, id, seq };
        }

        return { isNew: false };
    } catch (e) {
        log.error('Error guardando mensaje:', e.message);
        return { isNew: false, error: e.message };
    }
}

/**
 * Obtener mensajes paginados por sesión (patrón Mattermost: page-based history).
 * Ordena por seq DESC → reverse para orden cronológico.
 */
export async function getMessages(sessionId, { limit = 15, offset = 0, includeThinking = false } = {}) {
    try {
        const typeFilter = includeThinking ? '' : "AND section_type NOT IN ('thinking', 'status') AND is_visible = TRUE";

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM chat_messages WHERE session_id = $1 ${typeFilter}`,
            [sessionId]
        );
        const total = parseInt(countResult.rows[0].total);

        const result = await pool.query(
            `SELECT id, seq, uuid, section_type, text, has_code, buttons, html, is_visible, created_at
             FROM chat_messages
             WHERE session_id = $1 ${typeFilter}
             ORDER BY seq DESC
             LIMIT $2 OFFSET $3`,
            [sessionId, limit, offset]
        );

        return {
            messages: result.rows.reverse().map(formatMessage),
            total,
            hasMore: offset + limit < total,
        };
    } catch (e) {
        log.error('Error leyendo mensajes:', e.message);
        return { messages: [], total: 0, hasMore: false };
    }
}

/**
 * Obtener mensajes desde un seq dado (patrón Mattermost: sequence-based sync).
 * Para reconexión: Flutter envía lastSeq → server devuelve seq > lastSeq.
 */
export async function getMessagesSince(sessionId, lastSeq, { includeThinking = false } = {}) {
    try {
        const typeFilter = includeThinking ? '' : "AND section_type NOT IN ('thinking', 'status') AND is_visible = TRUE";

        const result = await pool.query(
            `SELECT id, seq, uuid, section_type, text, has_code, buttons, html, is_visible, created_at
             FROM chat_messages
             WHERE session_id = $1 AND seq > $2 ${typeFilter}
             ORDER BY seq ASC`,
            [sessionId, lastSeq]
        );

        return {
            messages: result.rows.map(formatMessage),
            lastSeq: result.rows.length > 0 ? result.rows[result.rows.length - 1].seq : lastSeq,
        };
    } catch (e) {
        log.error('Error sync mensajes:', e.message);
        return { messages: [], lastSeq };
    }
}

/**
 * Listar sesiones activas con último mensaje.
 */
export async function getSessions() {
    try {
        const result = await pool.query(
            `SELECT s.session_id, s.title, s.last_seq, s.message_count, s.updated_at,
                    m.text as last_message, m.section_type as last_type,
                    first_msg.text as first_user_message
             FROM chat_sessions s
             LEFT JOIN chat_messages m ON m.seq = s.last_seq
             LEFT JOIN LATERAL (
                SELECT text FROM chat_messages
                WHERE session_id = s.session_id AND section_type = 'user'
                ORDER BY seq ASC LIMIT 1
             ) first_msg ON true
             WHERE s.message_count > 1
             ORDER BY s.updated_at DESC
             LIMIT 50`
        );
        return result.rows;
    } catch (e) {
        log.error('Error leyendo sesiones:', e.message);
        return [];
    }
}

/** Formatear row de PG a objeto JSON para el cliente */
function formatMessage(r) {
    return {
        id: r.id,
        seq: parseInt(r.seq),
        uuid: r.uuid,
        sectionType: r.section_type,
        text: r.text,
        html: r.html || '',
        hasCode: r.has_code,
        buttons: r.buttons || [],
        isVisible: r.is_visible !== false,
        timestamp: r.created_at,
    };
}
