import express from 'express';
import { itemsRouter } from './routes/items';
import { reservationsRouter } from './routes/reservations';
import { maintenanceRouter } from './routes/maintenance';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/v1/items', itemsRouter);
  app.use('/v1/reservations', reservationsRouter);
  app.use('/v1/maintenance', maintenanceRouter);

  app.use(errorHandler);
  return app;
}
