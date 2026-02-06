# Protocol Components Usage Guide

## Components

### 1. ProtocolSelector
Visual dropdown for selecting device protocol type.

### 2. ProtocolConfigForm
Dynamic configuration form based on selected protocol.

## Integration Example

```typescript
import ProtocolSelector, { ProtocolType } from '@/components/ProtocolSelector';
import ProtocolConfigForm, { ProtocolConfig } from '@/components/ProtocolConfigForm';

// In your device type form state
const [connectivity, setConnectivity] = useState<ProtocolConfig>({
  protocol: 'mqtt',
  mqtt: {
    topic_pattern: '{{tenant_id}}/devices/{{device_id}}/telemetry',
    qos: 1,
    retain: false
  }
});

// In your JSX
<div className="space-y-6">
  {/* Protocol Selector */}
  <ProtocolSelector
    value={connectivity.protocol}
    onChange={(protocol) => {
      setConnectivity({
        ...connectivity,
        protocol
      });
    }}
  />

  {/* Protocol Configuration */}
  <ProtocolConfigForm
    protocol={connectivity.protocol}
    config={connectivity}
    onChange={setConnectivity}
  />
</div>
```

## Supported Protocols

| Protocol | Status | Description |
|----------|--------|-------------|
| **MQTT** | ✅ Ready | Standard IoT messaging |
| **HTTP/Webhook** | ✅ Ready | REST API push |
| **LoRaWAN** | ✅ Ready | Long-range, low-power |
| **Modbus** | ✅ Ready | Industrial PLCs |
| **OPC UA** | 🚧 Coming Soon | Industrial automation |
| **CoAP** | 🚧 Coming Soon | Lightweight protocol |
| **WebSocket** | 🚧 Coming Soon | Real-time bidirectional |
| **Custom** | 🚧 Coming Soon | User-defined parser |

## Device Type Form Integration

Replace the existing connectivity section in `/web/src/app/dashboard/device-types/[id]/page.tsx`:

```typescript
// OLD CODE (around line 788-856):
{expandedSections.connectivity && (
  <div className="p-6 space-y-6">
    <select value={form.connectivity.protocol}>
      <option value="mqtt">MQTT</option>
      <option value="lorawan">LoRaWAN</option>
    </select>
    {/* ... manual protocol-specific fields */}
  </div>
)}

// NEW CODE:
{expandedSections.connectivity && (
  <div className="p-6 space-y-6">
    <ProtocolSelector
      value={form.connectivity.protocol}
      onChange={(protocol) => {
        setForm({
          ...form,
          connectivity: {
            ...form.connectivity,
            protocol
          }
        });
      }}
    />

    <ProtocolConfigForm
      protocol={form.connectivity.protocol}
      config={form.connectivity}
      onChange={(connectivity) => {
        setForm({
          ...form,
          connectivity
        });
      }}
    />
  </div>
)}
```

## Benefits

- ✅ **Unified UI**: Consistent experience across all protocols
- ✅ **Extensible**: Easy to add new protocols
- ✅ **Type-safe**: Full TypeScript support
- ✅ **User-friendly**: Clear descriptions and examples
- ✅ **Validation**: Protocol-specific validation built-in
- ✅ **Professional**: Icons and visual indicators

## Next Steps

1. Integrate components into device type form
2. Update device creation to show protocol-specific credentials
3. Add connection instructions display
4. Test end-to-end protocol creation flow
