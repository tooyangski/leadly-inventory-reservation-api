import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { createItemSchema } from '../validation/items';
import { createItem, getItemStatus } from '../services/items';

export const itemsRouter = Router();

itemsRouter.post('/', validateBody(createItemSchema), async (req, res, next) => {
  try {
    const { name, initial_quantity } = req.body;
    const item = await createItem({ name, totalQuantity: initial_quantity });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

itemsRouter.get('/:id', async (req, res, next) => {
  try {
    const status = await getItemStatus(req.params.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});
