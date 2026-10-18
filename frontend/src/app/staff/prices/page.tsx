import { AuthGate } from "@/components/auth-gate";
import { StaffPriceManagement } from "@/components/staff-price-management";
import { ThemeProvider } from "flowbite-react";

// This workspace uses a light surface regardless of the system color scheme.
// Override Flowbite's paired dark styles together so controls remain readable.
const workspaceTheme = {
  button: { color: {
    light: "border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 focus:ring-gray-200 dark:border-gray-300 dark:bg-gray-50 dark:text-gray-700 dark:hover:bg-gray-100 dark:focus:ring-gray-200",
  } },
  card: { root: { base: "flex rounded-lg border border-gray-200 bg-white text-gray-900 shadow-none dark:border-gray-200 dark:bg-white dark:text-gray-900" } },
  label: { root: { colors: { default: "text-gray-900 dark:text-gray-900" } } },
  textInput: { field: { input: { colors: {
    gray: "border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:border-blue-600 focus:ring-blue-600 dark:border-gray-300 dark:bg-white dark:text-gray-900 dark:placeholder-gray-500 dark:focus:border-blue-600 dark:focus:ring-blue-600",
  } } } },
};

export default function StaffPricesPage() {
  return <ThemeProvider theme={workspaceTheme}><AuthGate><StaffPriceManagement /></AuthGate></ThemeProvider>;
}
