"use client";

import { Check, Phone, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Modal, ModalBody, ModalHeader, Spinner, Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from "flowbite-react";
import { useEffect, useState } from "react";
import { formatVnd } from "@/features/pricing/validation";
import { ApiRequestError } from "@/lib/api/client";
import { fetchCustomerOrderRequests, updateCustomerOrderStatus, type CustomerOrderRequest, type CustomerOrderStatus } from "@/lib/api/customer-orders";

const statusLabels: Record<CustomerOrderRequest["status"], string> = {
  pending_confirmation: "Chờ xác nhận", contacted: "Đã liên hệ", confirmed: "Đã xác nhận", cancelled: "Đã hủy",
};

export function CustomerOrderInbox({ onClose }: { onClose: () => void }) {
  const [requests, setRequests] = useState<CustomerOrderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try { setRequests((await fetchCustomerOrderRequests()).requests); }
    catch (loadError) {
      setError(loadError instanceof ApiRequestError && loadError.status === 403
        ? "Hộp nhận đơn chỉ dành cho chủ cửa hàng và biên tập viên."
        : "Không tải được yêu cầu đặt hàng. Kiểm tra kết nối rồi thử lại.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    fetchCustomerOrderRequests().then(result => {
      if (active) setRequests(result.requests);
    }).catch(loadError => {
      if (active) setError(loadError instanceof ApiRequestError && loadError.status === 403
        ? "Hộp nhận đơn chỉ dành cho chủ cửa hàng và biên tập viên."
        : "Không tải được yêu cầu đặt hàng. Kiểm tra kết nối rồi thử lại.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function update(request: CustomerOrderRequest, status: CustomerOrderStatus) {
    setBusyId(request.id);
    setError("");
    try {
      await updateCustomerOrderStatus(request.id, status);
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status } : item));
    } catch { setError("Không cập nhật được trạng thái. Tải lại rồi thử lại."); }
    finally { setBusyId(""); }
  }

  return <Modal show onClose={onClose} dismissible size="5xl">
    <ModalHeader><span id="customer-order-inbox-title">Yêu cầu đặt hàng</span></ModalHeader>
    <ModalBody>
      <div className="mb-5 flex items-center justify-between gap-3"><p className="text-sm text-gray-600">Liên hệ khách để xác nhận mặt hàng và cách giao.</p><Button type="button" color="light" aria-label="Tải lại yêu cầu" onClick={() => void load()} disabled={loading}><RefreshCw size={17}/></Button></div>
      {error && <Alert color="failure" className="mb-4">{error}</Alert>}
      {loading ? <div className="flex items-center gap-3 py-8 text-gray-600"><Spinner aria-label="Đang tải yêu cầu" size="md"/>Đang tải yêu cầu…</div> : error ? null : requests.length ? <Table>
        <TableHead className="hidden md:table-header-group"><TableHeadCell>Yêu cầu / Mặt hàng</TableHeadCell><TableHeadCell>Liên hệ</TableHeadCell><TableHeadCell>Tạm tính</TableHeadCell><TableHeadCell>Trạng thái / Xử lý</TableHeadCell></TableHead>
        <TableBody className="divide-y divide-gray-200">{requests.map(request => <TableRow key={request.id} className="block border-b border-gray-200 bg-white py-3 md:table-row md:border-0 md:py-0">
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-semibold text-gray-900">{request.reference}</p><p className="mt-1 text-sm text-gray-500">{new Date(request.createdAt).toLocaleString("vi-VN")}</p><ul className="mt-3 space-y-2">{request.items.map((item, index) => <li key={index}><p className="text-sm text-gray-900">{item.productName} · {item.variantName}</p><p className="text-sm text-gray-500">{item.quantity} × {formatVnd(item.unitPrice)} · {item.packaging}</p></li>)}</ul></TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-medium text-gray-900">{request.customerName}</p><a className="mt-2 inline-flex items-center gap-2 text-blue-700" href={`tel:${request.phone}`}><Phone size={14}/>{request.phone}</a>{request.deliveryAddress && <p className="mt-2 text-sm">{request.deliveryAddress}</p>}{request.deliveryNotes && <p className="mt-2 text-sm">Ghi chú: {request.deliveryNotes}</p>}</TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-semibold whitespace-nowrap text-gray-900 tabular-nums">{formatVnd(request.subtotal)}</p><p className="mt-1 text-sm text-gray-500">Chưa gồm phí giao</p></TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><Badge className="w-fit" color={request.status === "confirmed" ? "success" : request.status === "cancelled" ? "failure" : request.status === "contacted" ? "info" : "warning"}>{statusLabels[request.status]}</Badge>
            {(request.status === "pending_confirmation" || request.status === "contacted") && <div className="mt-3 flex flex-wrap gap-2">
              {request.status === "pending_confirmation" && <Button size="sm" color="light" disabled={busyId === request.id} onClick={() => void update(request, "contacted")}>Đã gọi khách</Button>}
              <Button size="sm" disabled={busyId === request.id} onClick={() => void update(request, "confirmed")}><Check size={14} className="mr-1"/>Xác nhận đơn</Button><Button size="sm" color="light" disabled={busyId === request.id} onClick={() => void update(request, "cancelled")}>Hủy yêu cầu</Button>
            </div>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table> : <p className="py-8 text-sm text-gray-600">Chưa có yêu cầu mới. Yêu cầu của khách sẽ xuất hiện tại đây.</p>}
    </ModalBody>
  </Modal>;
}
