import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "./lib/CartContext";
import { Home } from "./pages/Home";
import { Menu } from "./pages/Menu";

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
        </Routes>
      </BrowserRouter>
    </CartProvider>
  );
}
