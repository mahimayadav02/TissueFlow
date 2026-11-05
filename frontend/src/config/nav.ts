// Sidebar menu for each role. "phase" says when the page gets built (see the frontend plan).
import {
  AlertTriangle, BarChart3, Boxes, Bug, ClipboardCheck, ClipboardList, FileText, FlaskConical,
  Gauge, History, Home, IndianRupee, LayoutDashboard, PackageCheck, QrCode, ScanLine, Settings2,
  ShoppingCart, Sprout, Thermometer, TrendingUp, UserCheck, Users, Warehouse, type LucideIcon,
} from 'lucide-react';
import type { Role } from '../lib/types';

export interface NavItem { label: string; path: string; icon: LucideIcon; phase: number }
export interface NavSection { title: string; items: NavItem[] }

export const NAV: Record<Role, NavSection[]> = {
  MANAGER: [
    { title: 'Overview', items: [
      { label: 'Dashboard', path: '/m', icon: LayoutDashboard, phase: 6 },
    ] },
    { title: 'Production', items: [
      { label: 'Batches', path: '/m/batches', icon: Sprout, phase: 3 },
      { label: 'Trays and QR', path: '/m/trays', icon: QrCode, phase: 3 },
      { label: 'Contamination', path: '/m/contamination', icon: Bug, phase: 3 },
      { label: 'Daily work', path: '/m/daily', icon: ClipboardList, phase: 4 },
    ] },
    { title: 'Stock, orders, costs', items: [
      { label: 'Stock and media', path: '/m/stock', icon: Warehouse, phase: 5 },
      { label: 'Orders', path: '/m/orders', icon: ShoppingCart, phase: 5 },
      { label: 'Monthly costs', path: '/m/costs', icon: IndianRupee, phase: 5 },
    ] },
    { title: 'Results', items: [
      { label: 'Forecast and profit', path: '/m/forecast', icon: TrendingUp, phase: 6 },
      { label: 'Room monitoring', path: '/m/monitoring', icon: Thermometer, phase: 6 },
      { label: 'Alerts', path: '/m/alerts', icon: AlertTriangle, phase: 6 },
      { label: 'Reports', path: '/m/reports', icon: FileText, phase: 6 },
    ] },
    { title: 'Set-up', items: [
      { label: 'Lab, zones, benches', path: '/m/setup/lab', icon: Settings2, phase: 2 },
      { label: 'Crops, stages, media', path: '/m/setup/masters', icon: FlaskConical, phase: 2 },
      { label: 'Users', path: '/m/setup/users', icon: Users, phase: 2 },
      { label: 'Audit log', path: '/m/audit', icon: History, phase: 6 },
    ] },
  ],
  SUPERVISOR: [
    { title: 'My zones', items: [
      { label: 'Zone dashboard', path: '/s', icon: Gauge, phase: 4 },
      { label: 'Attendance', path: '/s/attendance', icon: UserCheck, phase: 4 },
      { label: 'Assign work', path: '/s/assign', icon: ClipboardList, phase: 4 },
      { label: 'Verify entries', path: '/s/verify', icon: ClipboardCheck, phase: 4 },
    ] },
    { title: 'Production', items: [
      { label: 'Batches', path: '/s/batches', icon: Sprout, phase: 3 },
      { label: 'Trays', path: '/s/trays', icon: QrCode, phase: 3 },
      { label: 'Losses', path: '/s/losses', icon: Bug, phase: 3 },
      { label: 'Media and stock', path: '/s/media', icon: Boxes, phase: 5 },
    ] },
    { title: 'Results', items: [
      { label: 'Room monitoring', path: '/s/monitoring', icon: Thermometer, phase: 6 },
      { label: 'Alerts', path: '/s/alerts', icon: AlertTriangle, phase: 6 },
      { label: 'Reports', path: '/s/reports', icon: FileText, phase: 6 },
    ] },
  ],
  OPERATOR: [
    { title: 'My work', items: [
      { label: 'Today', path: '/o', icon: Home, phase: 4 },
      { label: 'Scan tray', path: '/o/scan', icon: ScanLine, phase: 4 },
      { label: 'Report loss', path: '/o/loss', icon: Bug, phase: 4 },
      { label: 'My output', path: '/o/output', icon: BarChart3, phase: 4 },
      { label: 'Attendance', path: '/o/attendance', icon: PackageCheck, phase: 4 },
      { label: 'Alerts', path: '/o/alerts', icon: AlertTriangle, phase: 6 },
    ] },
  ],
};

export function allItems(role: Role): NavItem[] {
  return NAV[role].flatMap((s) => s.items);
}
