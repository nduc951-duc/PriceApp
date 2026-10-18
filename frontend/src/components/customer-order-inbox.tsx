"use client";

import { Check, Phone, Plus, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Modal, ModalBody, ModalHeader, Spinner, Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from "flowbite-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StaffCustomerOrderForm } from "@/components/staff-customer-order-form";
import { OrderWorkspaceTheme } from "@/components/order-workspace-theme";
import { formatVnd } from "@/features/pricing/validation";
import { formatPackageContents, getSellingUnitLabel } from "@/features/pricing/package-display";
import { ApiRequestError } from "@/lib/api/client";
import { fetchCustomerOrderRequests, updateCustomerOrderStatus, type CustomerOrderRequest, type CustomerOrderStatus } from "@/lib/api/customer-orders";

const statusLabels: Record<CustomerOrderRequest["status"], string> = {
  pending_confirmation: "Chờ xác nhận", contacted: "Đã liên hệ", confirmed: "Đã xác nhận", cancelled: "Đã hủy",
};

export function CustomerOrderInbox({ onClose, createdReference }: { onClose: () => void; createdReference?: string }) {
  const [requests, setRequests] = useState<CustomerOrderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [success, setSuccess] = useState(createdReference ? `Đã tạo đơn ${createdReference}.` : "");

  async function load() {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      setRequests((await fetchCustomerOrderRequests()).requests);
      setStatusError("");
    }
    catch (loadError) {
      setAccessDenied(loadError instanceof ApiRequestError && loadError.status === 403);
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
      if (active) setAccessDenied(loadError instanceof ApiRequestError && loadError.status === 403);
      if (active) setError(loadError instanceof ApiRequestError && loadError.status === 403
        ? "Hộp nhận đơn chỉ dành cho chủ cửa hàng và biên tập viên."
        : "Không tải được yêu cầu đặt hàng. Kiểm tra kết nối rồi thử lại.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function update(request: CustomerOrderRequest, status: CustomerOrderStatus) {
    setBusyId(request.id);
    setStatusError("");
    try {
      await updateCustomerOrderStatus(request.id, status);
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status } : item));
    } catch { setStatusError("Không cập nhật được trạng thái. Tải lại rồi thử lại."); }
    finally { setBusyId(""); }
  }

  return <OrderWorkspaceTheme><Modal show onClose={() => { if (!creatingBusy) onClose(); }} dismissible={!creatingBusy} size="5xl">
    <ModalHeader><span id="customer-order-inbox-title">{creating ? "Tạo đơn cho khách" : "Yêu cầu đặt hàng"}</span></ModalHeader>
    <ModalBody>
      {creating ? <StaffCustomerOrderForm onCancel={() => setCreating(false)} onSubmittingChange={setCreatingBusy} onCreated={receipt => { setCreating(false); setSuccess(`Đã tạo đơn ${receipt.reference}.`); void load(); }}/> : <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-gray-600">Nhận đơn khách gửi hoặc tạo đơn tại quầy, rồi xác nhận mặt hàng và cách giao.</p><Link href="/shop" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-blue-700 underline">Trang khách đặt hàng</Link></div><div className="flex items-center gap-2"><Button type="button" onClick={() => { setSuccess(""); setCreating(true); }} disabled={loading || accessDenied}><Plus size={16} className="mr-2"/>Tạo đơn</Button><Button type="button" color="light" aria-label="Tải lại yêu cầu" onClick={() => void load()} disabled={loading}><RefreshCw size={17}/></Button></div></div>
      {success && <Alert color="success" className="mb-4">{success}</Alert>}
      {error && <Alert color="failure" className="mb-4">{error}</Alert>}
      {statusError && <Alert color="failure" className="mb-4">{statusError}</Alert>}
      {loading ? <div className="flex items-center gap-3 py-8 text-gray-600"><Spinner aria-label="Đang tải yêu cầu" size="md"/>Đang tải yêu cầu…</div> : error ? null : requests.length ? <Table>
        <TableHead className="hidden md:table-header-group"><TableHeadCell>Yêu cầu / Mặt hàng</TableHeadCell><TableHeadCell>Liên hệ</TableHeadCell><TableHeadCell>Tạm tính</TableHeadCell><TableHeadCell>Trạng thái / Xử lý</TableHeadCell></TableHead>
        <TableBody className="divide-y divide-gray-200">{requests.map(request => <TableRow key={request.id} className="block border-b border-gray-200 bg-white py-3 md:table-row md:border-0 md:py-0 dark:border-gray-200 dark:bg-white">
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-semibold text-gray-900">{request.reference}</p><p className="mt-1 text-sm text-gray-500">{new Date(request.createdAt).toLocaleString("vi-VN")}</p><ul className="mt-3 space-y-2">{request.items.map((item, index) => { const sellingUnit = getSellingUnitLabel(item.packaging); const contents = formatPackageContents(item.packageQuantity, item.unit); return <li key={index}><p className="text-sm text-gray-900">{item.productName} · {item.variantName}</p><p className="text-sm text-gray-500">{item.quantity} × {formatVnd(item.unitPrice)} / {sellingUnit ?? "đơn vị bán chưa xác định"}{contents && <span> · mỗi {sellingUnit ?? "đơn vị bán"} chứa {contents}</span>}</p></li>; })}</ul></TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-medium text-gray-900">{request.customerName}</p><a className="mt-2 inline-flex items-center gap-2 text-blue-700" href={`tel:${request.phone}`}><Phone size={14}/>{request.phone}</a>{request.deliveryAddress && <p className="mt-2 text-sm">{request.deliveryAddress}</p>}{request.deliveryNotes && <p className="mt-2 text-sm">Ghi chú: {request.deliveryNotes}</p>}</TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><p className="font-semibold whitespace-nowrap text-gray-900 tabular-nums">{formatVnd(request.subtotal)}</p><p className="mt-1 text-sm text-gray-500">Chưa gồm phí giao</p></TableCell>
          <TableCell className="block px-3 py-2 align-top md:table-cell md:py-4"><Badge className="w-fit" color={request.status === "confirmed" ? "success" : request.status === "cancelled" ? "failure" : request.status === "contacted" ? "info" : "warning"}>{statusLabels[request.status]}</Badge>
            {(request.status === "pending_confirmation" || request.status === "contacted") && <div className="mt-3 flex flex-wrap gap-2">
              {request.status === "pending_confirmation" && <Button size="sm" color="light" disabled={busyId === request.id} onClick={() => void update(request, "contacted")}>Đã gọi khách</Button>}
              <Button size="sm" disabled={busyId === request.id} onClick={() => void update(request, "confirmed")}><Check size={14} className="mr-1"/>Xác nhận đơn</Button><Button size="sm" color="light" disabled={busyId === request.id} onClick={() => void update(request, "cancelled")}>Hủy yêu cầu</Button>
            </div>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table> : <p className="py-8 text-sm text-gray-600">Chưa có yêu cầu mới. Khách có thể gửi từ trang Khách hàng hoặc nhân viên bấm “Tạo đơn” ở trên.</p>}
      </>}
    </ModalBody>
  </Modal></OrderWorkspaceTheme>;
}
