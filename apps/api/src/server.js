import { app } from './app.js';
import { logEvent } from './http.js';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (use el rol nexo_app). Ver .env.example');
  process.exit(1);
}
const port = Number(process.env.PORT || 3000);
app.listen(port, () => logEvent({ level: 'info', msg: `NexoEntrega 360 en http://localhost:${port}` }));
