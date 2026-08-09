import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../lib/AuthContext";
import { Branch, CustomerAddress, DeliveryZone, Region, formatAddressSummary } from "../lib/addressTypes";

interface FormState {
  id: number | null;
  label: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  main_region_id: string;
  nearest_branch_id: string;
  zone_id: string;
  alt_phone: string;
  alt_phone_has_whatsapp: boolean;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  street: "",
  building: "",
  floor: "",
  apartment: "",
  landmark: "",
  main_region_id: "",
  nearest_branch_id: "",
  zone_id: "",
  alt_phone: "",
  alt_phone_has_whatsapp: false,
  latitude: null,
  longitude: null,
};

export function Addresses() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [zoneSearch, setZoneSearch] = useState("");
  const [zoneListOpen, setZoneListOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) navigate("/login");
  }, [authLoading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      supabase.from("regions").select("id, name").order("name"),
      supabase.from("branches").select("id, name, region_id").order("name"),
      supabase.from("customer_addresses").select("*").order("created_at", { ascending: false }),
    ]).then(([regionsRes, branchesRes, addressesRes]) => {
      setRegions((regionsRes.data as Region[]) ?? []);
      setBranches((branchesRes.data as Branch[]) ?? []);
      if (addressesRes.error) {
        // PGRST205 = PostgREST can't find the table in its schema cache;
        // raw postgres "relation does not exist" (42P01) can also surface
        // depending on the code path - either means 0005 isn't applied yet.
        const err = addressesRes.error;
        if (err.code === "42P01" || err.code === "PGRST205" || err.message.includes("Could not find the table")) {
          setTableMissing(true);
        }
      } else {
        setAddresses((addressesRes.data as CustomerAddress[]) ?? []);
      }
      setLoading(false);
    });
  }, [session]);

  // Zones are scoped to whichever branch is picked - loaded fresh instead
  // of filtering one big upfront fetch, since a branch can carry 100+ of
  // the real 644 zones and most never need to be in memory at once.
  useEffect(() => {
    if (!form.nearest_branch_id) {
      setZones([]);
      return;
    }
    supabase
      .from("delivery_zones")
      .select("id, branch_id, zone_name, delivery_fee")
      .eq("branch_id", Number(form.nearest_branch_id))
      .order("zone_name")
      .then(({ data }) => {
        const loaded = (data as DeliveryZone[]) ?? [];
        setZones(loaded);
        if (form.zone_id && !zoneSearch) {
          const match = loaded.find((z) => z.id === Number(form.zone_id));
          if (match) setZoneSearch(match.zone_name);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nearest_branch_id]);

  function openNewForm() {
    setForm(EMPTY_FORM);
    setZoneSearch("");
    setFormOpen(true);
    setError(null);
  }

  function openEditForm(addr: CustomerAddress) {
    setForm({
      id: addr.id,
      label: addr.label ?? "",
      street: addr.street ?? "",
      building: addr.building ?? "",
      floor: addr.floor ?? "",
      apartment: addr.apartment ?? "",
      landmark: addr.landmark ?? "",
      main_region_id: addr.main_region_id ? String(addr.main_region_id) : "",
      nearest_branch_id: addr.nearest_branch_id ? String(addr.nearest_branch_id) : "",
      zone_id: addr.zone_id ? String(addr.zone_id) : "",
      alt_phone: addr.alt_phone ?? "",
      alt_phone_has_whatsapp: addr.alt_phone_has_whatsapp,
      latitude: addr.latitude,
      longitude: addr.longitude,
    });
    setZoneSearch("");
    setFormOpen(true);
    setError(null);
  }

  function selectZone(zone: DeliveryZone) {
    setForm((f) => ({ ...f, zone_id: String(zone.id) }));
    setZoneSearch(zone.zone_name);
    setZoneListOpen(false);
  }

  const selectedZone = zones.find((z) => z.id === Number(form.zone_id)) ?? null;
  const filteredZones = zoneSearch.trim()
    ? zones.filter((z) => z.zone_name.includes(zoneSearch.trim())).slice(0, 30)
    : zones.slice(0, 30);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("المتصفح ده مش بيدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude }));
        setLocating(false);
      },
      () => {
        setError("مقدرناش ناخد موقعك - تأكد إنك سامح المتصفح بالوصول للموقع");
        setLocating(false);
      },
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.street.trim() || !form.building.trim()) {
      setError("اسم الشارع ورقم العمارة لازم يتملوا");
      return;
    }
    if (!form.main_region_id) {
      setError("اختار المنطقة الرئيسية");
      return;
    }
    if (!form.nearest_branch_id) {
      setError("اختار أقرب فرع");
      return;
    }
    if (form.alt_phone && !/^01[0-9]{9}$/.test(form.alt_phone.replace(/\D/g, ""))) {
      setError("الرقم البديل لازم يكون رقم موبايل مصري صحيح");
      return;
    }
    setSaving(true);
    const payload = {
      user_id: session!.user.id,
      label: form.label.trim() || null,
      street: form.street.trim(),
      building: form.building.trim(),
      floor: form.floor.trim() || null,
      apartment: form.apartment.trim() || null,
      landmark: form.landmark.trim() || null,
      main_region_id: Number(form.main_region_id),
      nearest_branch_id: Number(form.nearest_branch_id),
      zone_id: form.zone_id ? Number(form.zone_id) : null,
      alt_phone: form.alt_phone ? form.alt_phone.replace(/\D/g, "") : null,
      alt_phone_has_whatsapp: form.alt_phone ? form.alt_phone_has_whatsapp : false,
      latitude: form.latitude,
      longitude: form.longitude,
    };
    const query = form.id
      ? supabase.from("customer_addresses").update(payload).eq("id", form.id).select().single()
      : supabase.from("customer_addresses").insert(payload).select().single();
    const { data, error: saveError } = await query;
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    const saved = data as CustomerAddress;
    setAddresses((prev) => (form.id ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev]));
    setFormOpen(false);
  }

  async function handleDelete(id: number) {
    const { error: deleteError } = await supabase.from("customer_addresses").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setAddresses((prev) => prev.filter((a) => a.id !== id));
  }

  const branchesInRegion = form.main_region_id
    ? branches.filter((b) => b.region_id === Number(form.main_region_id))
    : branches;

  if (authLoading || loading) {
    return (
      <div className="wrap section">
        <p className="muted">جاري التحميل...</p>
      </div>
    );
  }

  if (tableMissing) {
    return (
      <div>
        <AddressesHeader />
        <div className="wrap section">
          <h2 className="section-title">عناويني</h2>
          <p className="error-text">
            شاشة العناوين محتاجة تحديث في قاعدة البيانات لسه ما اتنفذش. كلم فريق التقنية.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AddressesHeader />
      <div className="wrap section">
      <h2 className="section-title">عناويني</h2>

      {!formOpen && (
        <>
          <div className="address-list">
            {addresses.map((addr) => (
              <div key={addr.id} className="address-card">
                <div className="address-card-body">
                  {addr.label && <span className="address-label">{addr.label}</span>}
                  <p>{formatAddressSummary(addr, regions, branches)}</p>
                  {(addr.floor || addr.apartment) && (
                    <p className="muted">
                      {addr.floor && `الدور ${addr.floor}`} {addr.apartment && `- شقة ${addr.apartment}`}
                    </p>
                  )}
                  {addr.landmark && <p className="muted">علامة مميزة: {addr.landmark}</p>}
                </div>
                <div className="address-card-actions">
                  <button className="btn btn-ghost" onClick={() => openEditForm(addr)}>
                    تعديل
                  </button>
                  <button className="btn btn-ghost" onClick={() => handleDelete(addr.id)}>
                    حذف
                  </button>
                </div>
              </div>
            ))}
            {addresses.length === 0 && <p className="muted">لسه معندكش عناوين محفوظة.</p>}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openNewForm}>
            + إضافة عنوان جديد
          </button>
        </>
      )}

      {formOpen && (
        <form className="address-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="label">اسم العنوان (اختياري)</label>
            <input id="label" placeholder="البيت / الشغل" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="street">اسم الشارع</label>
            <input id="street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="building">رقم العمارة</label>
              <input id="building" value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="floor">الدور</label>
              <input id="floor" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="apartment">الشقة</label>
              <input id="apartment" value={form.apartment} onChange={(e) => setForm({ ...form, apartment: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="landmark">علامة مميزة</label>
            <input id="landmark" placeholder="جنب... / قدام..." value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="region">المنطقة الرئيسية</label>
              <select
                id="region"
                value={form.main_region_id}
                onChange={(e) => setForm({ ...form, main_region_id: e.target.value, nearest_branch_id: "" })}
              >
                <option value="">اختار المنطقة</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="branch">أقرب فرع</label>
              <select
                id="branch"
                value={form.nearest_branch_id}
                onChange={(e) => {
                  setForm({ ...form, nearest_branch_id: e.target.value, zone_id: "" });
                  setZoneSearch("");
                }}
              >
                <option value="">اختار الفرع</option>
                {branchesInRegion.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.nearest_branch_id && (
            <div className="field zone-picker">
              <label htmlFor="zone">منطقتك (لتحديد سعر التوصيل بدقة - اختياري)</label>
              <input
                id="zone"
                placeholder="اكتب اسم الشارع أو المنطقة..."
                value={zoneSearch}
                onChange={(e) => {
                  setZoneSearch(e.target.value);
                  setZoneListOpen(true);
                  if (form.zone_id) setForm((f) => ({ ...f, zone_id: "" }));
                }}
                onFocus={() => setZoneListOpen(true)}
                onBlur={() => setTimeout(() => setZoneListOpen(false), 150)}
                autoComplete="off"
              />
              {zoneListOpen && filteredZones.length > 0 && (
                <ul className="zone-dropdown">
                  {filteredZones.map((z) => (
                    <li key={z.id}>
                      <button type="button" onMouseDown={() => selectZone(z)}>
                        <span>{z.zone_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedZone && (
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  سعر التوصيل من الفرع ده لمنطقتك: {selectedZone.delivery_fee}ج
                </p>
              )}
              {!selectedZone && zones.length === 0 && (
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  الفرع ده لسه معندوش قايمة مناطق مفصّلة - هيتحسب سعر التوصيل العام للفرع.
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="alt_phone">رقم بديل (اختياري)</label>
            <input
              id="alt_phone"
              type="tel"
              dir="ltr"
              placeholder="01xxxxxxxxx"
              value={form.alt_phone}
              onChange={(e) => setForm({ ...form, alt_phone: e.target.value })}
            />
          </div>
          {form.alt_phone && (
            <label className="field-check">
              <input
                type="checkbox"
                checked={form.alt_phone_has_whatsapp}
                onChange={(e) => setForm({ ...form, alt_phone_has_whatsapp: e.target.checked })}
              />
              الرقم ده عليه واتساب
            </label>
          )}

          <div className="field">
            <label>الموقع على الخريطة</label>
            <button type="button" className="btn btn-ghost" onClick={useMyLocation} disabled={locating}>
              {locating ? "جاري تحديد الموقع..." : form.latitude ? "تم تحديد موقعك ✓ - غيّر الموقع" : "استخدم موقعي الحالي"}
            </button>
          </div>

          {error && <span className="error-text">{error}</span>}

          <div className="form-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ العنوان"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </button>
          </div>
        </form>
      )}
      </div>
    </div>
  );
}

function AddressesHeader() {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" className="brand" style={{ textDecoration: "none" }}>
          كشري الغباشي
        </Link>
        <Link to="/menu" className="btn btn-ghost">
          رجوع للمنيو
        </Link>
      </div>
    </header>
  );
}
