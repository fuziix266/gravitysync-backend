import { Server } from 'socket.io';
import log from '../utils/logger.js';

/**
 * Crear servidor Socket.IO con auth por email (patrón Mattermost: session-based auth).
 */
export function createWSServer(httpServer) {
    const io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        pingTimeout: 30000,
        pingInterval: 10000,
    });

    // Auth middleware: email requerido
    io.use((socket, next) => {
        const email = socket.handshake.auth.email;
        if (!email) {
            return next(new Error('Auth error: email required'));
        }
        socket.email = email;
        next();
    });

    return io;
}

/**
 * Obtener la room del usuario (aislamiento por email).
 */
export function getUserRoom(email) {
    return `room_${email}`;
}
