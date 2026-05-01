import { redirect } from 'next/navigation';
import { ROUTES } from '@nest/config/constants';

export default function AccountPage() {
  redirect(ROUTES.account.orders);
}
