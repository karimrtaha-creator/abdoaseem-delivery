import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { CartProvider } from "./lib/CartContext";
import { Home } from "./pages/Home";
import { Menu } from "./pages/Menu";
import { Login } from "./pages/Login";
import { Addresses } from "./pages/Addresses";
import { Branches } from "./pages/Branches";
import { Checkout } from "./pages/Checkout";
import { Orders } from "./pages/Orders";
import { Settings } from "./pages/Settings";
import { CompleteProfile } from "./components/CompleteProfile";

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/login" element={<Login />} />
            <Route path="/addresses" element={<Addresses />} />
            <Route path="/branches" element={<Branches />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </BrowserRouter>
        <CompleteProfile />
      </CartProvider>
    </AuthProvider>
  );
}
