import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sid = process.argv[2] || '';
if (!sid) { console.error('need sid'); process.exit(1); }

(async()=>{
  const { kvmConnector } = await import('../src/connectors/kvm-connector');
  const ports = await kvmConnector.listSandboxPorts(sid, { refresh: 'true', verify: 'true', wait_seconds: '5' } as any);
  const items = ((ports as any)?.data?.items || []) as any[];
  const normalized = items.map((x)=>({
    vmPort: x.vmPort ?? x.vm_port,
    hostPort: x.hostPort ?? x.host_port,
    hostIp: x.hostIp ?? x.host_ip,
    vmPortReady: x.vmPortReady ?? x.vm_port_ready,
    hostPortReady: x.hostPortReady ?? x.host_port_ready,
    mappingId: x.mappingId ?? x.mapping_id ?? x.portMappingId ?? x.port_mapping_id ?? x?.portReadyDetail?.mappingId,
    mappingEpoch: x.mappingEpoch ?? x.mapping_epoch ?? x?.portReadyDetail?.mappingEpoch,
    sessionId: x.sessionId ?? x.session_id,
  }));
  console.log(JSON.stringify({ count: normalized.length, items: normalized }, null, 2));
})();
