import { Pool, PoolClient } from 'pg';

export type Queryable = Pool | PoolClient;

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export interface ItemRow {
  id: string;
  name: string;
  total_quantity: number;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  item_id: string;
  customer_id: string;
  quantity: number;
  status: ReservationStatus;
  created_at: string;
  expires_at: string;
}
