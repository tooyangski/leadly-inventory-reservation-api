import express from 'express';
import swaggerUi from 'swagger-ui-express';
import openapiDocument from './openapi/openapi.json';
import { itemsRouter } from './routes/items';
import { reservationsRouter } from './routes/reservations';
import { maintenanceRouter } from './routes/maintenance';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/openapi.json', (_req, res) => res.json(openapiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

  app.use('/v1/items', itemsRouter);
  app.use('/v1/reservations', reservationsRouter);
  app.use('/v1/maintenance', maintenanceRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}
