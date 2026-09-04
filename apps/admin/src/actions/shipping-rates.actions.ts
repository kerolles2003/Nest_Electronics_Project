'use server';

import { revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdminActor } from '@/lib/api/identity';
import type { AdminShippingRate } from '@/lib/api/types';

export interface ShippingRateActionResult {
  ok: boolean;
  error?: string;
  rate?: AdminShippingRate;
}

export async function updateShippingRateAction(
  governorate: string,
  feeInEgp: number,
): Promise<ShippingRateActionResult> {
  await requireAdminActor();

  // Convert EGP (major unit) to piastres (minor units: integer)
  const feeMinor = Math.round(feeInEgp * 100);
  if (feeMinor < 0 || isNaN(feeMinor)) {
    return { ok: false, error: 'Fee must be a non-negative number' };
  }

  const res = await tryApi(() => api.updateShippingRate(governorate, feeMinor));
  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error) };
  }

  revalidatePath('/settings');
  revalidatePath('/admin/settings');
  return { ok: true, rate: res.data.data };
}
