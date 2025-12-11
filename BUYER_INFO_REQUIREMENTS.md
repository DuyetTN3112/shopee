# Điều kiện để lấy thông tin người mua (Buyer Info) trên Shopee

## Tóm tắt vấn đề

Shopee áp dụng chính sách **"Buyer Info Masking"** để bảo vệ quyền riêng tư người mua. Thông tin như tên, số điện thoại được hiển thị dưới dạng `****` khi gọi API.

---

## Thông tin nào bị ẩn (Masked)?

| Trường | Bị ẩn | Ví dụ |
|--------|-------|-------|
| `recipient_address.name` | ✅ Có | `****` |
| `recipient_address.phone` | ✅ Có | `****` |
| `recipient_address.full_address` | ❌ Không | Hiện đầy đủ |
| `buyer_username` | ❌ Không | `local_main.vn` |
| `buyer_user_id` | ❌ Không | `102429134` |

---

## Các cách lấy thông tin buyer thật

### Cách 1: API `get_shipping_document_data_info` + OCR

**Điều kiện bắt buộc:**
1. ✅ Đơn hàng phải có **tracking number** (mã vận đơn)
2. ✅ Status đơn phải là: `READY_TO_SHIP`, `PROCESSED`, `SHIPPED`, hoặc `COMPLETED`
3. ❌ **KHÔNG** hoạt động với đơn `CANCELLED`, `UNPAID`

**Cách hoạt động:**
```
Gọi API get_shipping_document_data_info
        ↓
Nhận về hình ảnh PNG (base64) chứa:
  - Tên người nhận
  - Số điện thoại  
  - Địa chỉ đầy đủ
        ↓
Dùng OCR (Tesseract) để đọc text từ hình
        ↓
Lưu vào database
```

**Hạn chế:**
- Chỉ hoạt động khi đơn đã được xác nhận ship
- Cần thêm thư viện OCR
- Độ chính xác OCR: 95-99%

---

### Cách 2: In phiếu giao hàng (AWB)

Thông tin buyer đầy đủ sẽ xuất hiện trên:
- **Phiếu giao hàng (Airway Bill)** khi in qua API `get_shipping_document`
- **Seller Center** của Shopee

**Điều kiện:**
- Đơn phải ở status `READY_TO_SHIP` trở lên

---

### Cách 3: Liên hệ qua Shopee Chat

Nếu cần thông tin buyer cho mục đích xử lý đơn hàng:
- Sử dụng **Shopee Chat** trong app/web Seller Center
- Chat trực tiếp với buyer để xin thông tin

---

## Bảng tổng hợp theo Order Status

| Order Status | Có tracking? | Lấy được buyer info? | Phương pháp |
|--------------|--------------|----------------------|-------------|
| `UNPAID` | ❌ | ❌ Không | - |
| `READY_TO_SHIP` | ✅ | ✅ Có | OCR từ shipping doc |
| `PROCESSED` | ✅ | ✅ Có | OCR từ shipping doc |
| `SHIPPED` | ✅ | ✅ Có | OCR từ shipping doc |
| `COMPLETED` | ✅ | ✅ Có* | OCR (nếu còn data) |
| `CANCELLED` | ❌ | ❌ Không | - |
| `TO_RETURN` | ✅ | ✅ Có | OCR từ shipping doc |

---

## Kết luận

**Để lấy được thông tin buyer thật (tên + SĐT), bạn cần:**

1. **Đơn hàng đã được thanh toán** và đang ở status `READY_TO_SHIP` hoặc cao hơn
2. **Đơn không bị hủy** (`CANCELLED`)
3. **Sử dụng API `get_shipping_document_data_info`** để lấy hình ảnh
4. **Dùng OCR** để trích xuất text từ hình ảnh

> ⚠️ **Lưu ý quan trọng:** 
> Với 2 đơn test hiện tại đều ở status `CANCELLED`, không thể lấy được thông tin buyer thật. Cần có đơn hàng mới với status `READY_TO_SHIP` trở lên.
