import { zhCN } from '@clerk/localizations';
import { mountAuth } from './features/auth/AuthEntry';
import './styles/auth.css';

mountAuth('zh', zhCN as never);
