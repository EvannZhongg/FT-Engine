#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "driver/usb_serial_jtag.h"

// 【关键头文件】用于底层硬件操作
#include "esp_rom_gpio.h"       // GPIO 矩阵操作
#include "soc/gpio_sig_map.h"   // 信号索引定义
#include "driver/periph_ctrl.h" // 外设时钟控制

// BLE (NimBLE) Includes
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "COUNTER_PROJECT";

#define DEVICE_NAME_PREFIX "Counter-"
#define MAX_BLE_DEVICE_NAME_LEN 31
#define MAX_CUSTOM_NAME_BYTES (MAX_BLE_DEVICE_NAME_LEN - (sizeof(DEVICE_NAME_PREFIX) - 1))
#define DEVICE_NAME_NVS_NAMESPACE "counter_cfg"
#define DEVICE_NAME_NVS_KEY "ble_alias"
#define USB_FRAME_MAGIC_0 'F'
#define USB_FRAME_MAGIC_1 'T'
#define USB_FRAME_MAGIC_2 'E'
#define USB_FRAME_MAGIC_3 '1'
#define USB_CMD_RESET 0x01
#define USB_CMD_RENAME 0x02
#define USB_CMD_IDENTIFY 0x03
#define USB_EVT_COUNTER 0x11
#define USB_RSP_IDENTIFY 0x12
#define USB_RSP_COMMAND 0x13
#define USB_RX_BUFFER_CAPACITY 128
#define USB_TX_FRAME_CAPACITY 64

// *** 1. 引脚定义 ***

// 7段数码管段位 (A-G)
#define SEG_A_PIN   GPIO_NUM_4
#define SEG_B_PIN   GPIO_NUM_2
#define SEG_C_PIN   GPIO_NUM_7
#define SEG_D_PIN   GPIO_NUM_6
#define SEG_E_PIN   GPIO_NUM_5
#define SEG_F_PIN   GPIO_NUM_3
#define SEG_G_PIN   GPIO_NUM_8


#define DIG_1_PIN   GPIO_NUM_10 
#define DIG_2_PIN   GPIO_NUM_20 // 注意：IO20 需要在 app_main 中禁用 UART0，你的代码已包含此逻辑
#define DIG_3_PIN   GPIO_NUM_9

// 输入引脚
#define KEY_SWITCH_PIN  GPIO_NUM_0 // 键轴按键
#define ZERO_SWITCH_PIN GPIO_NUM_1 // 置零按键

// *** 2. 全局变量与数据结构 ***

static volatile int32_t g_counter = 0;

static volatile int32_t g_total_plus_counts = 0;
static volatile int32_t g_total_minus_counts = 0;

static char g_device_name[32] = DEVICE_NAME_PREFIX "Init";

#pragma pack(push, 1)
typedef struct {
    int32_t current_total;
    int8_t  event_type;
    int32_t total_plus;
    int32_t total_minus;
    uint32_t timestamp_ms;
} counter_event_t;
#pragma pack(pop)

static volatile counter_event_t g_last_event;
static volatile bool g_event_updated = false;

static uint16_t g_ble_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t g_counter_val_handle;
static uint8_t g_ble_addr_type;
static uint8_t g_usb_rx_buffer[USB_RX_BUFFER_CAPACITY];
static size_t g_usb_rx_len = 0;

void start_ble_advertising(void);
static void load_device_name_from_nvs_or_default(void);
void handle_zero_long_press(void);
static int rename_device_from_payload(const uint8_t *payload, uint16_t payload_len);
static uint8_t usb_calc_checksum(uint8_t frame_type, const uint8_t *payload, size_t payload_len);
static void usb_send_frame(uint8_t frame_type, const void *payload, size_t payload_len);
static void usb_send_command_response(uint8_t command_type, uint8_t status);
static void usb_send_identify_response(void);
static void usb_notify_event(void);
static void usb_process_rx(void);

// *** 3. 数码管定时器扫描 ***

const uint8_t segment_map[10] = {
    (1 << 6),                               // 0
    (1 << 0) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6), // 1
    (1 << 2) | (1 << 5),                    // 2
    (1 << 4) | (1 << 5),                    // 3
    (1 << 0) | (1 << 3) | (1 << 4),         // 4
    (1 << 1) | (1 << 4),                    // 5
    (1 << 1),                               // 6
    (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6), // 7
    0,                                      // 8
    (1 << 4)                                // 9
};

void set_segments_gpio(uint8_t mapping) {
    gpio_set_level(SEG_A_PIN, (mapping >> 0) & 1);
    gpio_set_level(SEG_B_PIN, (mapping >> 1) & 1);
    gpio_set_level(SEG_C_PIN, (mapping >> 2) & 1);
    gpio_set_level(SEG_D_PIN, (mapping >> 3) & 1);
    gpio_set_level(SEG_E_PIN, (mapping >> 4) & 1);
    gpio_set_level(SEG_F_PIN, (mapping >> 5) & 1);
    gpio_set_level(SEG_G_PIN, (mapping >> 6) & 1);
}

void display_timer_callback(void* arg) {
    static int scan_index = 0; 

    // 消隐
    gpio_set_level(DIG_1_PIN, 1);
    gpio_set_level(DIG_2_PIN, 1);
    gpio_set_level(DIG_3_PIN, 1);

    int32_t count = g_counter;
    uint32_t abs_val;
    bool is_neg = false;
    if (count < 0) {
        is_neg = true;
        abs_val = (uint32_t)(-count);
    } else {
        abs_val = (uint32_t)count;
    }

    uint8_t digit_val = 0;
    bool show_minus = false; 
    bool show_blank = false; 

    switch (scan_index) {
        case 0: 
            if (is_neg && abs_val >= 10) show_minus = true; 
            else if (!is_neg) digit_val = (abs_val / 100) % 10;
            else show_blank = true; 
            break;
        case 1: 
            if (is_neg && abs_val < 10) show_minus = true; 
            else digit_val = (abs_val / 10) % 10;
            break;
        case 2: 
            digit_val = abs_val % 10;
            break;
    }

    if (show_blank) {
        set_segments_gpio(0xFF); 
    } else if (show_minus) {
        gpio_set_level(SEG_A_PIN, 1); gpio_set_level(SEG_B_PIN, 1);
        gpio_set_level(SEG_C_PIN, 1); gpio_set_level(SEG_D_PIN, 1);
        gpio_set_level(SEG_E_PIN, 1); gpio_set_level(SEG_F_PIN, 1);
        gpio_set_level(SEG_G_PIN, 0);
    } else {
        if (digit_val > 9) digit_val = 0;
        set_segments_gpio(segment_map[digit_val]);
    }

    if (!show_blank) {
        if (scan_index == 0) gpio_set_level(DIG_1_PIN, 0);
        else if (scan_index == 1) gpio_set_level(DIG_2_PIN, 0);
        else if (scan_index == 2) gpio_set_level(DIG_3_PIN, 0);
    }

    scan_index++;
    if (scan_index > 2) scan_index = 0;
}

void init_display_gpio(void) {
    // 即使在 app_main 断开了矩阵，这里通过 gpio_config 再次确认引脚为输出模式
    // 这会将 IO MUX 切换到 GPIO 功能
    gpio_reset_pin(DIG_2_PIN);
    gpio_reset_pin(DIG_3_PIN);

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << SEG_A_PIN) | (1ULL << SEG_B_PIN) | (1ULL << SEG_C_PIN) |
                        (1ULL << SEG_D_PIN) | (1ULL << SEG_E_PIN) | (1ULL << SEG_F_PIN) |
                        (1ULL << SEG_G_PIN) | (1ULL << DIG_1_PIN) | (1ULL << DIG_2_PIN) |
                        (1ULL << DIG_3_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);
}

// *** 4. 按键处理 ***

void update_event(int8_t type) {
    g_last_event.current_total = g_counter;
    g_last_event.event_type = type;
    g_last_event.total_plus = g_total_plus_counts;
    g_last_event.total_minus = g_total_minus_counts;
    g_last_event.timestamp_ms = (uint32_t)(esp_timer_get_time() / 1000);
    g_event_updated = true;
}

void handle_key_action(void) {
    if (g_counter >= 999) g_counter = -99;
    else g_counter++;
    g_total_plus_counts++;
    update_event(1);
}

void handle_zero_click(void) {
    if (g_counter <= -99) g_counter = 999;
    else g_counter--;
    g_total_minus_counts++;
    update_event(-1);
}

void handle_zero_long_press(void) {
    g_counter = 0;
    g_total_plus_counts = 0;  
    g_total_minus_counts = 0; 
    update_event(0); 
    ESP_LOGI(TAG, "Counter Reset");
}

#define BTN_DEBOUNCE_TICKS  3
#define LONG_PRESS_TICKS    300 

void button_poll_task(void *arg) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << KEY_SWITCH_PIN) | (1ULL << ZERO_SWITCH_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);

    int key_stable = 1; int key_cnt = 0;
    int zero_stable = 1; int zero_cnt = 0;
    int zero_press_time = 0; bool zero_handled = false;

    while (1) {
        int key_raw = gpio_get_level(KEY_SWITCH_PIN);
        if (key_raw != key_stable) {
            if (++key_cnt >= BTN_DEBOUNCE_TICKS) {
                key_stable = key_raw;
                key_cnt = 0;
                if (key_stable == 0) handle_key_action();
            }
        } else key_cnt = 0;

        int zero_raw = gpio_get_level(ZERO_SWITCH_PIN);
        if (zero_raw != zero_stable) {
            if (++zero_cnt >= BTN_DEBOUNCE_TICKS) {
                zero_stable = zero_raw;
                zero_cnt = 0;
                if (zero_stable == 0) { zero_press_time = 0; zero_handled = false; }
                else if (!zero_handled) handle_zero_click();
            }
        } else {
            zero_cnt = 0;
            if (zero_stable == 0) {
                if (++zero_press_time >= LONG_PRESS_TICKS && !zero_handled) {
                    handle_zero_long_press();
                    zero_handled = true;
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10)); 
    }
}

static uint8_t usb_calc_checksum(uint8_t frame_type, const uint8_t *payload, size_t payload_len)
{
    uint8_t checksum = frame_type ^ (uint8_t)payload_len;
    size_t i;

    for (i = 0; i < payload_len; ++i) {
        checksum ^= payload[i];
    }

    return checksum;
}

static void usb_send_frame(uint8_t frame_type, const void *payload, size_t payload_len)
{
    uint8_t frame[USB_TX_FRAME_CAPACITY];
    const uint8_t *payload_bytes = (const uint8_t *)payload;
    size_t frame_len;
    int written;

    if (payload_len > 255 || (7 + payload_len) > sizeof(frame)) {
        return;
    }

    if (!usb_serial_jtag_is_driver_installed() || !usb_serial_jtag_is_connected()) {
        return;
    }

    frame[0] = USB_FRAME_MAGIC_0;
    frame[1] = USB_FRAME_MAGIC_1;
    frame[2] = USB_FRAME_MAGIC_2;
    frame[3] = USB_FRAME_MAGIC_3;
    frame[4] = frame_type;
    frame[5] = (uint8_t)payload_len;

    if (payload_len > 0 && payload_bytes != NULL) {
        memcpy(&frame[6], payload_bytes, payload_len);
    }

    frame[6 + payload_len] = usb_calc_checksum(frame_type, payload_bytes, payload_len);
    frame_len = 7 + payload_len;

    written = usb_serial_jtag_write_bytes((const char *)frame, frame_len, 0);
    if (written > 0) {
        usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(5));
    }
}

static void usb_send_command_response(uint8_t command_type, uint8_t status)
{
    uint8_t payload[2] = { command_type, status };
    usb_send_frame(USB_RSP_COMMAND, payload, sizeof(payload));
}

static void usb_send_identify_response(void)
{
    uint8_t mac[6];
    uint8_t payload[6 + 1 + sizeof(g_device_name)];
    size_t name_len = strlen(g_device_name);

    esp_read_mac(mac, ESP_MAC_BT);
    memcpy(payload, mac, sizeof(mac));
    payload[6] = (uint8_t)name_len;
    memcpy(&payload[7], g_device_name, name_len);
    usb_send_frame(USB_RSP_IDENTIFY, payload, 7 + name_len);
}

static void usb_handle_frame(uint8_t frame_type, const uint8_t *payload, size_t payload_len)
{
    int rc;

    switch (frame_type) {
    case USB_CMD_RESET:
        ESP_LOGI(TAG, "Received Reset Command from USB");
        handle_zero_long_press();
        usb_send_command_response(USB_CMD_RESET, 0);
        break;

    case USB_CMD_RENAME:
        ESP_LOGI(TAG, "Received Rename Command from USB");
        rc = rename_device_from_payload(payload, payload_len);
        usb_send_command_response(USB_CMD_RENAME, (rc == 0) ? 0 : 1);
        break;

    case USB_CMD_IDENTIFY:
        usb_send_identify_response();
        break;

    default:
        ESP_LOGW(TAG, "Unknown USB command: 0x%02X", frame_type);
        break;
    }
}

static void usb_notify_event(void)
{
    counter_event_t event_copy = g_last_event;
    usb_send_frame(USB_EVT_COUNTER, &event_copy, sizeof(event_copy));
}

static void usb_process_rx(void)
{
    uint8_t temp[64];
    int read_len = usb_serial_jtag_read_bytes(temp, sizeof(temp), 0);
    size_t offset = 0;

    if (read_len > 0) {
        if ((size_t)read_len > (sizeof(g_usb_rx_buffer) - g_usb_rx_len)) {
            g_usb_rx_len = 0;
        }

        if ((size_t)read_len <= (sizeof(g_usb_rx_buffer) - g_usb_rx_len)) {
            memcpy(&g_usb_rx_buffer[g_usb_rx_len], temp, read_len);
            g_usb_rx_len += (size_t)read_len;
        }
    }

    while ((g_usb_rx_len - offset) >= 7) {
        const uint8_t *cursor = &g_usb_rx_buffer[offset];
        size_t remaining = g_usb_rx_len - offset;
        uint8_t payload_len;
        size_t frame_len;
        uint8_t expected_checksum;
        const uint8_t *payload;

        if (cursor[0] != USB_FRAME_MAGIC_0 || cursor[1] != USB_FRAME_MAGIC_1 ||
            cursor[2] != USB_FRAME_MAGIC_2 || cursor[3] != USB_FRAME_MAGIC_3) {
            offset++;
            continue;
        }

        payload_len = cursor[5];
        frame_len = 7 + payload_len;
        if (remaining < frame_len) {
            break;
        }

        payload = &cursor[6];
        expected_checksum = usb_calc_checksum(cursor[4], payload, payload_len);
        if (cursor[6 + payload_len] == expected_checksum) {
            usb_handle_frame(cursor[4], payload, payload_len);
            offset += frame_len;
            continue;
        }

        offset++;
    }

    if (offset > 0) {
        memmove(g_usb_rx_buffer, &g_usb_rx_buffer[offset], g_usb_rx_len - offset);
        g_usb_rx_len -= offset;
    }
}


// *** 5. BLE (NimBLE) ***

static const ble_uuid128_t gatt_svc_uuid =
    BLE_UUID128_INIT(0x28, 0x91, 0xae, 0x8d, 0x3d, 0x45, 0x4f, 0xde,
                     0x81, 0x4a, 0x51, 0x69, 0xd0, 0x18, 0x50, 0x01);
static const ble_uuid128_t gatt_chr_uuid =
    BLE_UUID128_INIT(0x28, 0x91, 0xae, 0x8d, 0x3d, 0x45, 0x4f, 0xde,
                     0x81, 0x4a, 0x51, 0x69, 0xd0, 0x18, 0x50, 0x02);

void handle_zero_long_press(void);
static bool is_valid_utf8(const uint8_t *data, size_t len);
static void build_default_device_name(void);
static esp_err_t save_custom_name_to_nvs(const char *custom_name);
static void refresh_advertising_name(void);
static int rename_device_from_payload(const uint8_t *payload, uint16_t payload_len);

static bool is_valid_utf8(const uint8_t *data, size_t len)
{
    size_t i = 0;

    while (i < len) {
        uint8_t c = data[i];
        size_t remaining = len - i;

        if (c <= 0x7F) {
            i++;
            continue;
        }

        if ((c & 0xE0) == 0xC0) {
            if (remaining < 2 || (data[i + 1] & 0xC0) != 0x80 || c < 0xC2) {
                return false;
            }
            i += 2;
            continue;
        }

        if ((c & 0xF0) == 0xE0) {
            uint8_t c1;
            uint8_t c2;

            if (remaining < 3) {
                return false;
            }

            c1 = data[i + 1];
            c2 = data[i + 2];
            if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80) {
                return false;
            }
            if ((c == 0xE0 && c1 < 0xA0) || (c == 0xED && c1 >= 0xA0)) {
                return false;
            }
            i += 3;
            continue;
        }

        if ((c & 0xF8) == 0xF0) {
            uint8_t c1;
            uint8_t c2;
            uint8_t c3;

            if (remaining < 4) {
                return false;
            }

            c1 = data[i + 1];
            c2 = data[i + 2];
            c3 = data[i + 3];
            if ((c1 & 0xC0) != 0x80 || (c2 & 0xC0) != 0x80 || (c3 & 0xC0) != 0x80) {
                return false;
            }
            if ((c == 0xF0 && c1 < 0x90) || (c == 0xF4 && c1 >= 0x90) || c > 0xF4) {
                return false;
            }
            i += 4;
            continue;
        }

        return false;
    }

    return true;
}

static void build_default_device_name(void)
{
    uint8_t mac[6];

    esp_read_mac(mac, ESP_MAC_BT);
    snprintf(g_device_name, sizeof(g_device_name), DEVICE_NAME_PREFIX "%02X%02X", mac[4], mac[5]);
}

static esp_err_t save_custom_name_to_nvs(const char *custom_name)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(DEVICE_NAME_NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for BLE name: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_str(handle, DEVICE_NAME_NVS_KEY, custom_name);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to persist BLE alias: %s", esp_err_to_name(err));
    }

    return err;
}

static void load_device_name_from_nvs_or_default(void)
{
    nvs_handle_t handle;
    size_t required_len = 0;
    esp_err_t err = nvs_open(DEVICE_NAME_NVS_NAMESPACE, NVS_READONLY, &handle);

    if (err != ESP_OK) {
        build_default_device_name();
        return;
    }

    err = nvs_get_str(handle, DEVICE_NAME_NVS_KEY, NULL, &required_len);
    if (err == ESP_OK && required_len > 1 && required_len <= (MAX_CUSTOM_NAME_BYTES + 1)) {
        char custom_name[MAX_CUSTOM_NAME_BYTES + 1];

        err = nvs_get_str(handle, DEVICE_NAME_NVS_KEY, custom_name, &required_len);
        if (err == ESP_OK && is_valid_utf8((const uint8_t *)custom_name, required_len - 1) && custom_name[0] != '\0') {
            snprintf(g_device_name, sizeof(g_device_name), DEVICE_NAME_PREFIX "%s", custom_name);
            nvs_close(handle);
            return;
        }
    }

    nvs_close(handle);
    build_default_device_name();
}

static void refresh_advertising_name(void)
{
    int rc;

    if (g_ble_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        ESP_LOGI(TAG, "Rename will appear in scans after disconnect");
        return;
    }

    rc = ble_gap_adv_stop();
    if (rc == 0) {
        return;
    }

    if (rc != BLE_HS_EALREADY) {
        ESP_LOGW(TAG, "Adv stop before rename refresh failed: %d", rc);
    }
    start_ble_advertising();
}

static int rename_device_from_payload(const uint8_t *payload, uint16_t payload_len)
{
    char custom_name[MAX_CUSTOM_NAME_BYTES + 1];
    int rc;
    size_t i;

    if (payload_len == 0 || payload_len > MAX_CUSTOM_NAME_BYTES) {
        ESP_LOGW(TAG, "Rename rejected: invalid payload length %u", payload_len);
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    for (i = 0; i < payload_len; ++i) {
        if (payload[i] == '\0') {
            ESP_LOGW(TAG, "Rename rejected: embedded NUL byte");
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
    }

    if (!is_valid_utf8(payload, payload_len)) {
        ESP_LOGW(TAG, "Rename rejected: invalid UTF-8 payload");
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    memcpy(custom_name, payload, payload_len);
    custom_name[payload_len] = '\0';

    if (custom_name[0] == '\0') {
        ESP_LOGW(TAG, "Rename rejected: empty name");
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    rc = snprintf(g_device_name, sizeof(g_device_name), DEVICE_NAME_PREFIX "%s", custom_name);
    if (rc < 0 || rc >= sizeof(g_device_name)) {
        ESP_LOGW(TAG, "Rename rejected: formatted name too long");
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    if (save_custom_name_to_nvs(custom_name) != ESP_OK) {
        return BLE_ATT_ERR_UNLIKELY;
    }

    rc = ble_svc_gap_device_name_set(g_device_name);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to set BLE device name: %d", rc);
        return BLE_ATT_ERR_UNLIKELY;
    }

    ESP_LOGI(TAG, "BLE Name Updated: %s", g_device_name);
    refresh_advertising_name();
    return 0;
}

static int gatt_svc_access(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    // 1. 处理读取 (保持原样)
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        // ... (保持你原有的读取逻辑) ...
        counter_event_t evt;
        evt.current_total = g_counter;
        evt.event_type = 0; // Read 操作默认类型
        evt.total_plus = g_total_plus_counts;
        evt.total_minus = g_total_minus_counts;
        evt.timestamp_ms = (uint32_t)(esp_timer_get_time() / 1000);
        
        int rc = os_mbuf_append(ctxt->om, &evt, sizeof(evt));
        return (rc == 0) ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    // 2. 【新增】处理写入 (PC 发送重置指令)
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        uint8_t data[MAX_BLE_DEVICE_NAME_LEN + 1];

        if (len == 0 || len > sizeof(data)) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }

        if (ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), NULL) != 0) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }

        if (data[0] == 0x01) {
            ESP_LOGI(TAG, "Received Reset Command from PC");
            handle_zero_long_press();
            return 0;
        }

        if (data[0] == 0x02) {
            ESP_LOGI(TAG, "Received Rename Command from PC");
            return rename_device_from_payload(&data[1], len - 1);
        }

        ESP_LOGW(TAG, "Unknown BLE command: 0x%02X", data[0]);
        return BLE_ATT_ERR_UNLIKELY;
    }

    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &gatt_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {
                .uuid = &gatt_chr_uuid.u,
                .access_cb = gatt_svc_access,
                // 【修改】增加 BLE_GATT_CHR_F_WRITE 权限
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_WRITE, 
                .val_handle = &g_counter_val_handle,
            },
            {0}
        },
    },
    {0}
};

void ble_notify_event(void) {
    if (g_ble_conn_handle != BLE_HS_CONN_HANDLE_NONE) {
        counter_event_t event_copy = g_last_event;
        struct os_mbuf *om = ble_hs_mbuf_from_flat(&event_copy, sizeof(event_copy));
        if (om) {
            int rc = ble_gatts_notify_custom(g_ble_conn_handle, g_counter_val_handle, om);
            // 【重要修复】如果发送失败，必须手动释放 mbuf，否则会造成内存泄漏
            if (rc != 0) {
                os_mbuf_free_chain(om);
                ESP_LOGW(TAG, "Notify failed: %d", rc);
            }
        }
    }
}

static int ble_gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        ESP_LOGI(TAG, "BLE Connected");
        g_ble_conn_handle = event->connect.conn_handle;
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "BLE Disconnected");
        g_ble_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        start_ble_advertising();
        break;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        start_ble_advertising(); 
        break;
    }
    return 0;
}

void start_ble_advertising(void)
{
    struct ble_gap_adv_params adv_params;
    struct ble_hs_adv_fields fields;
    const char *name;
    int rc;

    memset(&fields, 0, sizeof(fields));
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;

    name = ble_svc_gap_device_name();
    fields.name = (uint8_t *)name;
    fields.name_len = strlen(name);
    fields.name_is_complete = 1;

    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) ESP_LOGE(TAG, "Adv fields error: %d", rc);

    memset(&adv_params, 0, sizeof(adv_params));
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    
    rc = ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER, &adv_params, ble_gap_event, NULL);
    if (rc != 0) ESP_LOGE(TAG, "Adv start error: %d", rc);
}

void ble_on_sync(void) {
    ble_hs_id_infer_auto(0, &g_ble_addr_type); 
    start_ble_advertising();
}

void ble_host_task(void *param) {
    nimble_port_run(); 
    nimble_port_freertos_deinit();
}

// *** 6. 主程序 ***

void app_main(void)
{
    // ================================================================
    // 【终极修复】物理切断 UART0 的所有输入源和时钟
    // 这是一个“核选项”，确保无论之前的状态如何，UART0 都彻底死掉。
    // ================================================================
    
    // 1. 强制关闭 UART0 外设时钟（切断电源）
    periph_module_disable(PERIPH_UART0_MODULE);
    
    // 2. 修改 GPIO 交换矩阵：强行将 UART0 的 RX 输入信号连接到一个常量“1”（高电平）
    // 这样，无论 GPIO 20 怎么翻转，UART0 内部只看到一条死一般平静的直线，永远不会触发中断。
    esp_rom_gpio_connect_in_signal(GPIO_MATRIX_CONST_ONE_INPUT, U0RXD_IN_IDX, false);
    
    // 3. 物理复位引脚
    gpio_reset_pin(GPIO_NUM_20);
    gpio_reset_pin(GPIO_NUM_21);

    // ================================================================

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    init_display_gpio();

    usb_serial_jtag_driver_config_t usb_cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb_cfg));
    
    xTaskCreate(button_poll_task, "btn_poll", 4096, NULL, 1, NULL);

    nimble_port_init();

    ble_svc_gap_init();
    ble_svc_gatt_init();
    load_device_name_from_nvs_or_default();
    ESP_ERROR_CHECK(ble_svc_gap_device_name_set(g_device_name));
    ESP_LOGI(TAG, "BLE Name Set: %s", g_device_name);
    ble_gatts_count_cfg(gatt_svcs);
    ble_gatts_add_svcs(gatt_svcs);
    ble_hs_cfg.sync_cb = ble_on_sync;
    nimble_port_freertos_init(ble_host_task);
    
    vTaskDelay(pdMS_TO_TICKS(500));

    esp_timer_handle_t display_timer;
    esp_timer_create_args_t timer_args = {
        .callback = &display_timer_callback,
        .name = "display_timer"
    };
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &display_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(display_timer, 5000)); 

    ESP_LOGI(TAG, "System Running (UART0 off on GPIO20/21, USB Serial/JTAG on GPIO18/19)");
    
    while (1) {
        usb_process_rx();
        if (g_event_updated) {
            ble_notify_event(); 
            usb_notify_event();
            g_event_updated = false;
        }
        vTaskDelay(pdMS_TO_TICKS(20)); 
    }
}
