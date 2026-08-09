#ifndef VAULTMESH_H
#define VAULTMESH_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define VAULTMESH_ABI_VERSION 1U

typedef uint32_t VaultmeshStatus;

#define VAULTMESH_STATUS_OK 0U
#define VAULTMESH_STATUS_INVALID_ARGUMENT 1U
#define VAULTMESH_STATUS_INCOMPATIBLE_ABI 2U
#define VAULTMESH_STATUS_CORE_ERROR 3U
#define VAULTMESH_STATUS_LOCKED 4U
#define VAULTMESH_STATUS_IO_ERROR 5U
#define VAULTMESH_STATUS_AUTH_FAILED 6U
#define VAULTMESH_STATUS_VAULT_EXISTS 7U
#define VAULTMESH_STATUS_NOT_FOUND 8U
#define VAULTMESH_STATUS_REAUTH_REQUIRED 9U
#define VAULTMESH_STATUS_VALUE_UNAVAILABLE 10U
#define VAULTMESH_STATUS_CONFLICT 11U
#define VAULTMESH_STATUS_PANIC 255U

#define VAULTMESH_ITEM_METADATA_SCHEMA_VERSION 1U
#define VAULTMESH_ITEM_KIND_LOGIN 1U
#define VAULTMESH_ITEM_KIND_PAYMENT_CARD 2U
#define VAULTMESH_ITEM_KIND_IDENTITY 3U
#define VAULTMESH_ITEM_KIND_SSH_CREDENTIAL 4U
#define VAULTMESH_ITEM_KIND_SECRET 5U

#define VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD 1U
#define VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP 2U
#define VAULTMESH_PROTECTED_FIELD_CARD_NUMBER 3U
#define VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE 4U
#define VAULTMESH_PROTECTED_FIELD_CARD_PIN 5U
#define VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD 6U
#define VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY 7U
#define VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY 8U
#define VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE 9U
#define VAULTMESH_PROTECTED_FIELD_SECRET_VALUE 10U

typedef struct VaultmeshBytes {
  const uint8_t *data;
  size_t len;
} VaultmeshBytes;

typedef struct VaultmeshBuffer {
  uint8_t *data;
  size_t len;
} VaultmeshBuffer;

typedef struct VaultmeshVault VaultmeshVault;

uint32_t vaultmesh_abi_version(void);
VaultmeshStatus vaultmesh_abi_check(uint32_t requested_version);
VaultmeshStatus vaultmesh_buffer_destroy(VaultmeshBuffer *buffer);
VaultmeshStatus vaultmesh_vault_create(uint32_t abi_version,
                                      VaultmeshBytes path,
                                      VaultmeshBytes master_password,
                                      VaultmeshVault **out_vault);
VaultmeshStatus vaultmesh_vault_unlock(uint32_t abi_version,
                                      VaultmeshBytes path,
                                      VaultmeshBytes master_password,
                                      VaultmeshVault **out_vault);
VaultmeshStatus vaultmesh_vault_unlock_with_key(uint32_t abi_version,
                                               VaultmeshBytes path,
                                               VaultmeshBytes vault_key,
                                               VaultmeshVault **out_vault);
VaultmeshStatus vaultmesh_vault_status(uint32_t abi_version,
                                      const VaultmeshVault *vault,
                                      uint8_t *out_is_locked);
VaultmeshStatus vaultmesh_vault_lock(uint32_t abi_version,
                                    VaultmeshVault *vault);
VaultmeshStatus vaultmesh_vault_quick_unlock_key(uint32_t abi_version,
                                                  const VaultmeshVault *vault,
                                                  VaultmeshBuffer *out_key);
VaultmeshStatus vaultmesh_browser_core_operation(uint32_t abi_version,
                                                  VaultmeshVault *vault,
                                                  VaultmeshBytes operation,
                                                  VaultmeshBytes input_json,
                                                  VaultmeshBuffer *out_json);
VaultmeshStatus vaultmesh_items_list(uint32_t abi_version,
                                    const VaultmeshVault *vault,
                                    VaultmeshBuffer *out_json);
VaultmeshStatus vaultmesh_item_detail(uint32_t abi_version,
                                     const VaultmeshVault *vault,
                                     uint32_t item_kind,
                                     VaultmeshBytes item_id,
                                     VaultmeshBuffer *out_json);
VaultmeshStatus vaultmesh_item_protected_value(uint32_t abi_version,
                                              const VaultmeshVault *vault,
                                              uint32_t item_kind,
                                              uint32_t protected_field,
                                              VaultmeshBytes item_id,
                                              VaultmeshBytes master_password,
                                              VaultmeshBuffer *out_value);
VaultmeshStatus vaultmesh_vault_destroy(VaultmeshVault **vault);

#ifdef __cplusplus
}
#endif

#endif
