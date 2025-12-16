
import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, Download, CheckCircle, AlertCircle, RefreshCw, AlertTriangle, Info } from 'lucide-react';

// --- Types ---

interface ProcessedOrder {
  id: string; // Unique key for merging (phone+zip+addr+name)
  orderIds: Set<string>;
  receiver: {
    name: string;
    phone: string;
    zip: string;
    address: string;
  };
  products: string[];
}

interface LogEntry {
  type: 'info' | 'merge' | 'error' | 'warning';
  message: string;
}

// --- Constants ---

const FIXED_VALUES = {
  deliveryMethod: 9,
  labelType: 1800800001,
  senderName: 'AIRUPA物流センター',
  senderZip: '455-0065',
  senderAddress: '名古屋市港区本宮新町86',
  packetSize: 20,
  serviceFee: 0,
  packingFee: 0,
};

// --- Helper Functions ---

const formatZip = (zip: string | number): string => {
  const s = String(zip).replace(/[^\d]/g, '');
  if (s.length === 7) {
    return `${s.slice(0, 3)}-${s.slice(3)}`;
  }
  return String(zip); // Return original if unknown format
};

const formatPhone = (phone: string | number): string => {
  return String(phone).replace(/\(\+81\)/g, '').replace(/[^\d]/g, '');
};

const calculateProduct = (name: string, quantity: number): string => {
  if (!name) return `Unknown*${quantity}`;

  const match = name.match(/^(.*)\*(\d+)$/);
  if (match) {
    const baseName = match[1];
    const packSize = parseInt(match[2], 10);
    
    if (quantity === 1) {
       return name;
    } else {
       const total = packSize * quantity;
       return `${baseName}*${total}`;
    }
  } else {
    return `${name}*${quantity}`;
  }
};

const findHeaderRow = (jsonData: any[]): number => {
  // 1. Priority: Check for specific TikTok layout (Order ID in A, Phone in AW)
  for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
    const row = jsonData[i];
    const valA = String(row['A'] || "").toLowerCase();
    const valAW = String(row['AW'] || "").toLowerCase();
    
    // Check for keywords in specific columns
    if ((valA.includes('id') || valA.includes('注文')) && 
        (valAW.includes('phone') || valAW.includes('電話'))) {
      return i;
    }
  }

  // 2. Fallback: Loose scan for any row with enough keywords
  const keywords = ["電話番号", "phone", "telephone", "注文ID", "order id", "orderid"];
  for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
    const row = jsonData[i];
    const rowValues = Object.values(row).map(v => String(v).toLowerCase());
    const matchCount = keywords.reduce((acc, k) => rowValues.some(v => v.includes(k)) ? acc + 1 : acc, 0);
    if (matchCount >= 2) {
      return i;
    }
  }
  return -1; // Not found
};

// --- Main Component ---

const App = () => {
  const [file, setFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedWorkbook, setProcessedWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [stats, setStats] = useState({ totalLines: 0, validOrders: 0, mergedGroups: 0 });
  const [hasMerges, setHasMerges] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setProcessedWorkbook(null);
      setLogs([]);
      setStats({ totalLines: 0, validOrders: 0, mergedGroups: 0 });
      setHasMerges(false);
    }
  };

  const processFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    setLogs([]);
    setHasMerges(false);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 'A' });

      if (jsonData.length < 2) {
        throw new Error("File appears to be empty or invalid format.");
      }

      // 1. Dynamic Header Detection
      const headerIndex = findHeaderRow(jsonData);
      if (headerIndex === -1) {
        throw new Error("Could not find a valid header row (looking for 'Phone', 'Order ID').");
      }

      const headerRow = jsonData[headerIndex];
      const columnMap: Record<string, string> = {};
      
      // Determine if this is the standard TikTok format we know
      const isTikTokFormat = 
        (String(headerRow['A'] || "").toLowerCase().includes('id') || String(headerRow['A'] || "").includes('注文')) &&
        (String(headerRow['AW'] || "").toLowerCase().includes('phone') || String(headerRow['AW'] || "").includes('電話'));

      if (isTikTokFormat) {
        // Enforce specific columns for TikTok
        columnMap.orderId = 'A';
        columnMap.name = 'AL';
        columnMap.zip = 'AP';
        columnMap.prefecture = 'AQ';
        columnMap.city = 'AR';
        columnMap.town = 'AS';
        columnMap.addr1 = 'AT';
        columnMap.addr2 = 'AU';
        columnMap.phone = 'AW';
      } else {
        // Dynamic mapping fallback
        const targetHeaders = {
          phone: ["電話番号", "telephone", "phone"],
          zip: ["郵便番号", "zip", "postal"],
          prefecture: ["都道府県"],
          city: ["市区町村"],
          town: ["町名"],
          addr1: ["詳細住所1"],
          addr2: ["詳細住所2"],
          name: ["受取人", "name", "recipient"],
          orderId: ["注文ID", "order id", "orderid"],
        };

        Object.entries(headerRow).forEach(([key, value]) => {
          const valStr = String(value).trim().toLowerCase();
          for (const [field, keywords] of Object.entries(targetHeaders)) {
            if (keywords.some(k => valStr.includes(k))) {
              columnMap[field] = key;
            }
          }
        });
      }

      const required = ['phone', 'zip', 'name', 'orderId'];
      const missing = required.filter(k => !columnMap[k]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required columns: ${missing.join(', ')}. Format detected: ${isTikTokFormat ? 'Standard TikTok' : 'Generic'}`);
      }

      // 2. Process Rows
      const orderMap = new Map<string, ProcessedOrder>();
      let processedLinesCount = 0;

      // Start from headerIndex + 1
      for (let i = headerIndex + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        const rawOrderId = row[columnMap.orderId];
        // Skip empty Order IDs
        if (!rawOrderId) continue; 
        
        // Skip if Order ID is just a repetition of the header (common in some exports)
        const headerName = String(headerRow[columnMap.orderId] || "").trim();
        if (String(rawOrderId).trim() === headerName) continue;

        const rawPhone = row[columnMap.phone];
        const cleanPhone = formatPhone(rawPhone);
        
        // --- STRICT VALIDATION ---
        // 1. Must have at least 8 digits (Japanese numbers are usually 10-11).
        //    This effectively skips "Instruction" rows or "Example" rows (Row 2 in some exports).
        if (!cleanPhone || cleanPhone.length < 8) continue;
        
        // 2. Additional check: ensure OrderID isn't just whitespace
        if (String(rawOrderId).trim().length === 0) continue;

        processedLinesCount++;
        
        const rawZip = row[columnMap.zip];
        const rawName = row[columnMap.name];
        
        const addrParts = [
          row[columnMap.prefecture],
          row[columnMap.city],
          row[columnMap.town],
          row[columnMap.addr1]
        ].filter(Boolean).map(s => String(s).trim());

        // Handle Addr2 logic (add parentheses if exists)
        const rawAddr2 = row[columnMap.addr2];
        if (rawAddr2 && String(rawAddr2).trim()) {
           addrParts.push(`(${String(rawAddr2).trim()})`);
        }
        
        const fullAddress = addrParts.join('');

        const cleanZip = formatZip(rawZip);
        const cleanName = String(rawName).trim();
        const cleanOrderId = String(rawOrderId).trim();

        // Product Logic: Column G and Column J (Standard locations)
        // If not TikTok format, we might need dynamic detection, but prompt didn't specify dynamic product cols.
        // Assuming G and J are standard for this file type.
        const rawProductName = row['G']; 
        const rawQuantity = row['J'];
        
        const productName = String(rawProductName || "").trim();
        const quantity = parseInt(rawQuantity || "0", 10);
        
        if (quantity > 0) {
            const finalProductString = calculateProduct(productName, quantity);

            // Merging Key
            const mergeKey = `${cleanPhone}|${cleanZip}|${fullAddress}|${cleanName}`;

            if (!orderMap.has(mergeKey)) {
              orderMap.set(mergeKey, {
                id: mergeKey,
                orderIds: new Set([cleanOrderId]),
                receiver: {
                  name: cleanName,
                  phone: cleanPhone,
                  zip: cleanZip,
                  address: fullAddress
                },
                products: [finalProductString]
              });
            } else {
              const existing = orderMap.get(mergeKey)!;
              existing.orderIds.add(cleanOrderId);
              existing.products.push(finalProductString);
            }
        }
      }

      // 3. Generate Output
      const outputRows: any[] = [];
      const logsToAppend: LogEntry[] = [];
      let sequence = 1;
      let mergeEventCount = 0;

      orderMap.forEach((group) => {
        const orderIdList = Array.from(group.orderIds);
        
        if (orderIdList.length > 1) {
          mergeEventCount++;
          logsToAppend.push({
            type: 'merge',
            message: `MERGED: ${group.receiver.name} has ${orderIdList.length} orders combined. IDs: ${orderIdList.join(', ')}`
          });
        }

        const rowData = {
          A: sequence++,
          B: FIXED_VALUES.deliveryMethod,
          C: FIXED_VALUES.labelType,
          D: '',
          E: '',
          F: group.receiver.phone,
          G: group.receiver.zip,
          H: group.receiver.address,
          I: group.receiver.name,
          J: '',
          K: '',
          L: '',
          M: '',
          // N, O, P order changed as requested
          N: FIXED_VALUES.senderZip,      // Was O
          O: FIXED_VALUES.senderAddress,  // Was P
          P: FIXED_VALUES.senderName,     // Was N
          Q: group.products.join('\n'),
          R: FIXED_VALUES.packetSize,
          S: '',
          T: FIXED_VALUES.serviceFee,
          U: FIXED_VALUES.packingFee,
          V: orderIdList.join('\n'),
        };
        outputRows.push(rowData);
      });

      const totalGroups = outputRows.length;
      const isMerged = processedLinesCount > totalGroups;
      setHasMerges(isMerged);
      setStats({ 
        totalLines: processedLinesCount, 
        validOrders: processedLinesCount, 
        mergedGroups: totalGroups 
      });
      
      if (isMerged) {
        setLogs(prev => [{ type: 'warning', message: `⚠️ ATTENTION: ${processedLinesCount - totalGroups} orders were merged into existing shipments.` }, ...logsToAppend, ...prev]);
      } else {
        setLogs(prev => [{ type: 'info', message: `✅ ${processedLinesCount} orders processed. No merges required.` }, ...prev]);
      }

      if (outputRows.length === 0) {
         setLogs(prev => [...prev, { type: 'error', message: 'No valid orders found to export. Please check the file format.' }]);
         setIsProcessing(false);
         return;
      }

      // 4. Create Workbook
      // Updated headers: N=Zip, O=Addr, P=Name
      const headerRowValues = [
        "序号", "配送方法", "送り状種類", "伝票番号", "送料", "電話番号", "郵便番号", "住所", "氏名", 
        "お届け希望日", "時間帯指定", "出荷予定日", "ご依頼主電話番号", "ご依頼主郵便番号", "ご依頼主住所1", 
        "ご依頼主名", "品名", "ゆうパケット専用サイズ欄", "注意写真", "代引金額", "梱包資材費", "記事"
      ];

      const wsData = [
         [], // Row 1 (Empty)
         [], // Row 2 (Empty)
         [], // Row 3 (Empty)
         headerRowValues, // Row 4 (Title)
         ...outputRows.map(r => [
           r.A, r.B, r.C, r.D, r.E, r.F, r.G, r.H, r.I, r.J, r.K, r.L, r.M, r.N, r.O, r.P, r.Q, r.R, r.S, r.T, r.U, r.V
         ])
      ];

      const newWorksheet = XLSX.utils.aoa_to_sheet(wsData);
      
      newWorksheet['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 5 }, 
        { wch: 15 }, { wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 30 }, // N(Zip)=15, O(Addr)=30
        { wch: 20 }, // P(Name)=20
        { wch: 40 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }
      ];

      const newWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Sheet1");

      setProcessedWorkbook(newWorkbook);
      setLogs(prev => [...prev, { type: 'info', message: 'Processing complete. Ready to download.' }]);

    } catch (err: any) {
      console.error(err);
      setLogs(prev => [...prev, { type: 'error', message: `Processing failed: ${err.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadFile = () => {
    if (!processedWorkbook) return;
    
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const filename = `邮局小包-Capypie${month}.${day}.xlsx`;
    
    XLSX.writeFile(processedWorkbook, filename);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center">
          <FileSpreadsheet className="mx-auto h-12 w-12 text-indigo-600" />
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            TikTok Order Processor
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Upload your TikTok order file (.xlsx) to generate the warehouse shipping list.
          </p>
        </div>

        <div className="bg-white p-8 rounded-lg shadow-md space-y-6">
          
          {/* File Upload */}
          <div className="flex items-center justify-center w-full">
            <label htmlFor="dropzone-file" className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${file ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'}`}>
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className={`w-8 h-8 mb-3 ${file ? 'text-indigo-500' : 'text-gray-400'}`} />
                <p className="mb-2 text-sm text-gray-500">
                  <span className="font-semibold">{file ? file.name : "Click to upload"}</span> or drag and drop
                </p>
                <p className="text-xs text-gray-500">XLSX files only</p>
              </div>
              <input id="dropzone-file" type="file" className="hidden" accept=".xlsx" onChange={handleFileUpload} />
            </label>
          </div>

          {/* Actions */}
          {file && !processedWorkbook && (
            <button
              onClick={processFile}
              disabled={isProcessing}
              className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${isProcessing ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="animate-spin -ml-1 mr-2 h-4 w-4" />
                  Processing...
                </>
              ) : (
                'Process Order File'
              )}
            </button>
          )}

          {/* Results Area */}
          {(processedWorkbook || logs.length > 0) && (
            <div className="bg-gray-50 rounded-md p-4 border border-gray-200">
              
              {/* Merge Alert Banner */}
              {hasMerges ? (
                <div className="mb-4 bg-yellow-50 border-l-4 border-yellow-400 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-yellow-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-yellow-700">
                        <strong>Order Merges Detected:</strong> Some orders with the same address and phone number were combined. Check the log below for details.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-4 bg-green-50 border-l-4 border-green-400 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <Info className="h-5 w-5 text-green-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-green-700">
                        <strong>No Merges Needed:</strong> All orders in this file are unique shipments.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <h3 className="text-sm font-medium text-gray-900 mb-3">Processing Log</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto text-sm">
                {logs.length === 0 && isProcessing && <p className="text-gray-500 italic">Reading file...</p>}
                {logs.map((log, idx) => (
                  <div key={idx} className={`flex items-start ${log.type === 'error' ? 'text-red-600' : log.type === 'warning' ? 'text-amber-700 font-semibold' : log.type === 'merge' ? 'text-amber-600' : 'text-green-600'}`}>
                    {log.type === 'error' && <AlertCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />}
                    {(log.type === 'merge' || log.type === 'warning') && <RefreshCw className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />}
                    {log.type === 'info' && <CheckCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />}
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
              
              {processedWorkbook && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex justify-between items-center mb-4">
                     <span className="text-gray-700 text-sm">Processed <strong>{stats.totalLines}</strong> valid lines into <strong>{stats.mergedGroups}</strong> shipping entries.</span>
                  </div>
                  <button
                    onClick={downloadFile}
                    className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                  >
                    <Download className="-ml-1 mr-2 h-4 w-4" />
                    Download Result (.xlsx)
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
