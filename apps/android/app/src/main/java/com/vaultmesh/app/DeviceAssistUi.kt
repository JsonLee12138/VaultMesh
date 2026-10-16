package com.vaultmesh.app

import android.Manifest
import android.app.Application
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

@Composable
internal fun DeviceAssistPanel(peers: List<LanTrusted>, settingsPeer: LanTrusted? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var serviceState by remember { mutableStateOf(DeviceAssistService.state) }
    var busy by remember { mutableStateOf(false) }
    var serviceEnabled by remember { mutableStateOf(DeviceAssistService.enabled(context)) }
    var permissionResults by remember { mutableStateOf(0) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissionResults++ }
    suspend fun open(): Boolean = withContext(Dispatchers.IO) {
        val key = LanPairingKeyService(context.applicationContext as Application).readOrCreate() ?: return@withContext false
        try { VaultNativeBridge.assistOpen(key) == "ok" } finally { key.fill(0) }
    }
    LaunchedEffect(peers.map { it.pairingRef }) {
        if (!open()) { error = "无法读取互通设置，请重新解锁"; return@LaunchedEffect }
        while (isActive) {
            status = withContext(Dispatchers.IO) { runCatching { JSONObject(VaultNativeBridge.assistStatus()) }.getOrNull() }
            serviceState = DeviceAssistService.state
            serviceEnabled = DeviceAssistService.enabled(context)
            delay(1000)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("设备填充互通", style = MaterialTheme.typography.titleMedium)
        if (settingsPeer != null) {
            Text("开启后，号码会加密注册到电脑，手机离线也可填入；换号或撤销在下次连通时更新。验证码推送到各授权电脑内存，两分钟内各可使用一次；只在电脑点选时填入。", style = MaterialTheme.typography.bodySmall)
            val peer = settingsPeer
            val grants = status?.optJSONArray("grants")
            val grant = grants?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("peer") == peer.pairingRef } }
            // Switches flip immediately; saves run in order and the latest choice wins.
            var pending by remember(peer.pairingRef) { mutableStateOf<Pair<Boolean, Boolean>?>(null) }
            val saving = remember(peer.pairingRef) { Mutex() }
            val phone = pending?.first ?: (grant?.optBoolean("phone") == true)
            val sms = pending?.second ?: (grant?.optBoolean("sms") == true)
            val phonePermission = context.checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS) == android.content.pm.PackageManager.PERMISSION_GRANTED
            // Only availability is exposed to the UI; the number itself stays in LocalPhoneNumber.
            var numberReady by remember { mutableStateOf<Boolean?>(null) }
            LaunchedEffect(phone, phonePermission, permissionResults) {
                numberReady = if (phone) withContext(Dispatchers.IO) { LocalPhoneNumber(context).suggestedNumber() != null } else null
            }
            fun change(nextPhone: Boolean, nextSms: Boolean) {
                val needed = buildList {
                    if (nextPhone && !phone && !phonePermission) add(Manifest.permission.READ_PHONE_NUMBERS)
                    if (nextSms && !sms && context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) != android.content.pm.PackageManager.PERMISSION_GRANTED) add(Manifest.permission.RECEIVE_SMS)
                }
                val target = nextPhone to nextSms
                pending = target
                error = null
                if (needed.isNotEmpty()) permission.launch(needed.toTypedArray())
                scope.launch {
                    saving.withLock {
                        if (pending != target) return@withLock
                        val (result, next) = withContext(Dispatchers.IO) {
                            VaultNativeBridge.assistGrant(peer.pairingRef, target.first, target.second) to
                                runCatching { JSONObject(VaultNativeBridge.assistStatus()) }.getOrNull()
                        }
                        if (next != null) status = next
                        if (result != "ok") error = "授权未保存，请重新解锁后重试"
                        if (pending == target) pending = null
                    }
                }
            }
            val ready = status?.has("grants") == true
            Row { Text("向此电脑提供手机号码", Modifier.weight(1f)); Switch(phone, { change(it, sms) }, enabled = ready) }
            if (phone && numberReady == false) {
                Text(if (phonePermission) "未读取到 SIM 号码，请在首页“本机号码填充”中设置备用号码。" else "未授予号码权限，电脑无法获取号码；也可在首页“本机号码填充”中设置备用号码。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                if (!phonePermission) TextButton(onClick = { permission.launch(arrayOf(Manifest.permission.READ_PHONE_NUMBERS)) }) { Text("授予号码权限") }
            }
            Row { Text("向此电脑提供短信验证码", Modifier.weight(1f)); Switch(sms, { change(phone, it) }, enabled = ready) }
        }
        if (settingsPeer == null) {
            Text(serviceState, style = MaterialTheme.typography.bodySmall)
            Text("在设备条目的更多操作中设置同步与填充授权。", style = MaterialTheme.typography.bodySmall)
            if ((status?.optJSONArray("requests")?.length() ?: 0) > 0) {
                Text("有待处理的填充请求，可在对应设备设置中手动输入验证码。", style = MaterialTheme.typography.bodySmall)
            }
            if (Build.VERSION.SDK_INT >= 37) Text("此系统可能延迟验证码交付；收不到时可在设备设置中手动输入。", style = MaterialTheme.typography.bodySmall)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            DeviceAssistSwitch(serviceEnabled, !busy && status?.has("grants") == true) { value ->
                if (DeviceAssistService.setEnabled(context, value)) {
                    serviceEnabled = value
                    error = null
                    if (value) {
                        val needed = buildList {
                            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) add(Manifest.permission.POST_NOTIFICATIONS)
                            if (Build.VERSION.SDK_INT >= 37 && context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != android.content.pm.PackageManager.PERMISSION_GRANTED) add(Manifest.permission.ACCESS_LOCAL_NETWORK)
                        }
                        if (needed.isNotEmpty()) permission.launch(needed.toTypedArray())
                        else DeviceAssistService.startIfEnabled(context)
                    }
                } else error = "无法保存互通开关，请重试"
            }
            Text("开关会保存。开启后锁屏、关闭应用仍可互通；系统允许时自动恢复，通知中可随时关闭。", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (serviceEnabled && Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    TextButton(onClick = { permission.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) }) { Text("通知权限") }
                }
                if (serviceEnabled && Build.VERSION.SDK_INT >= 37 && context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    TextButton(onClick = { permission.launch(arrayOf(Manifest.permission.ACCESS_LOCAL_NETWORK)) }) { Text("本地网络权限") }
                }
                TextButton(onClick = { permission.launch(arrayOf(Manifest.permission.RECEIVE_SMS)) }) { Text("短信权限") }
            }
        } else error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        val requests = if (settingsPeer != null) status?.optJSONArray("requests") else null
        if (requests != null) for (i in 0 until requests.length()) {
            val request = requests.getJSONObject(i)
            if (request.optString("peer") != settingsPeer?.pairingRef) continue
            key(request.optString("id")) {
                var code by remember { mutableStateOf("") }
                val peer = peers.firstOrNull { it.pairingRef == request.optString("peer") }
                Text("${peer?.label ?: "已配对电脑"} · ${request.optString("origin")}", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(code, { code = it.filter(Char::isLetterOrDigit).take(10) }, label = { Text("手动输入或粘贴验证码") }, singleLine = true)
                Button(enabled = code.length in 4..10 && !busy, onClick = {
                    val value = code; code = ""; busy = true
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { VaultNativeBridge.assistCode(value, "手动输入", 0, java.util.UUID.randomUUID().toString(), request.getString("id")) }
                        error = if (result == "ok") null else "请求已失效，请在电脑重新打开候选"
                        busy = false
                    }
                }) { Text("交付到此请求") }
            }
        }
    }
}

@Composable
internal fun DeviceAssistSwitch(checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text("保持设备互通", Modifier.weight(1f))
        Switch(checked = checked, enabled = enabled || checked, onCheckedChange = onChange)
    }
}
