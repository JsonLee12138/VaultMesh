use thiserror::Error;

#[derive(Debug, Error, Eq, PartialEq)]
pub enum VaultError {
    #[error("不支持该保险库格式")]
    UnsupportedFormat,
    #[error("无法使用此密码打开保险库，或保险库已被修改")]
    UnlockFailed,
    #[error("保险库数据无效")]
    InvalidPayload,
    #[error("保险库已锁定")]
    Locked,
    #[error("请求的条目不存在")]
    ItemNotFound,
    #[error("请求的回收站条目不存在")]
    TrashItemNotFound,
    #[error("请求的历史版本不存在")]
    RevisionNotFound,
    #[error("需要使用当前主密码再次验证")]
    MasterPasswordRequired,
    #[error("网站地址无效或不受支持")]
    InvalidUrl,
    #[error("验证器密钥无效或不受支持")]
    InvalidTotpSecret,
    #[error("该条目没有验证器密钥")]
    TotpUnavailable,
    #[error("恢复码无效")]
    InvalidRecoveryCodes,
    #[error("该条目没有恢复码")]
    RecoveryCodesUnavailable,
    #[error("支付卡号无效")]
    InvalidCardNumber,
    #[error("支付卡有效期无效")]
    InvalidCardExpiration,
    #[error("支付卡安全码无效")]
    InvalidCardSecurityCode,
    #[error("支付卡 PIN 无效")]
    InvalidCardPin,
    #[error("该支付卡没有请求的秘密字段")]
    CardSecretUnavailable,
    #[error("SSH 凭据必须包含密码、公钥或私钥")]
    InvalidSshCredential,
    #[error("密钥条目无效")]
    InvalidSecretItem,
    #[error("SSH 公钥无效或不受支持")]
    InvalidSshPublicKey,
    #[error("SSH 私钥无效或不受支持")]
    InvalidSshPrivateKey,
    #[error("该 SSH 凭据没有请求的字段")]
    SshSecretUnavailable,
    #[error("身份信息无效")]
    InvalidIdentity,
    #[error("邮箱账户配置无效")]
    InvalidEmailAccount,
    #[error("Agent 内部连接定义无效")]
    InvalidAgentConnectorDefinition,
    #[error("Agent 审计事件无效")]
    InvalidAgentAudit,
    #[error("网站/服务记录或关系无效")]
    InvalidService,
    #[error("请求的网站/服务不存在")]
    ServiceNotFound,
    #[error("自动整理预览已过期")]
    ServiceAggregationPlanExpired,
    #[error("API 环境无效")]
    InvalidApiEnvironment,
    #[error("请求的 API 环境不存在")]
    ApiEnvironmentNotFound,
    #[error("API 请求无效")]
    InvalidApiRequest,
    #[error("API 请求计划已过期或环境发生变化")]
    ApiRequestPlanStale,
    #[error("加密操作失败")]
    Crypto,
    #[error("序列化失败")]
    Serialization,
}
