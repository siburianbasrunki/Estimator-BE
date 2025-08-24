export type VolumeDetailPayload = {
  nama: string;
  jenis: "penjumlahan" | "pengurangan";
  panjang: number;
  lebar: number;
  tinggi: number;
  jumlah: number;
  volume: number; // FE sudah hitung (p*l*t*jumlah), BE tetap simpan
  extras?: { name: string; value: number }[];
};
export interface EstimationItemData {
  title: string;
  item: Array<{
    kode: string;
    nama: string;
    satuan: string;
    harga: number;
    volume: number;
    hargaTotal: number;
    details?: VolumeDetailPayload[];
  }>;
}

export interface CreateEstimationData {
  projectName: string;
  owner: string;
  ppn: string;
  notes: string;
  customFields: Record<string, string>;
  estimationItem: EstimationItemData[];
}
