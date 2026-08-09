export type LoginCopyMetadata = {
  username: string;
  hasPassword: boolean;
  hasTotpSecret: boolean;
};

export function loginCopyOptions(item: LoginCopyMetadata): string[] {
  return [
    item.username.trim().length > 0 ? "用户名" : null,
    item.hasPassword ? "密码" : null,
    item.hasTotpSecret ? "验证码" : null,
  ].filter((option): option is string => option !== null);
}
