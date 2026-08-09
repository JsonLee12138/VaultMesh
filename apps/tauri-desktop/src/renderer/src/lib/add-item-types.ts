export const ADD_ITEM_TYPES = [
  { id: 'login', label: '登录', route: '/vault/items/new' },
  { id: 'paymentCard', label: '支付卡', route: '/vault/cards/new' },
  { id: 'sshCredential', label: 'SSH 账号或密钥', route: '/vault/ssh/new' },
  { id: 'secret', label: '密钥', route: '/vault/secrets/new' },
  { id: 'identity', label: '身份', route: '/vault/identities/new' },
] as const;
