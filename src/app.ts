import express from 'express';
import { itemsRouter } from './routes/items';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/v1/items', itemsRouter);

  app.use(errorHandler);
  return app;
}
