import { z } from "zod";
export const priceSchema=z.coerce.number().finite().nonnegative().max(999_999_999_999);
export const formatVnd=(amount:number)=>new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(amount);
