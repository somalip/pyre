import ctypes, ctypes.util, json, time, sys

try:
    libIOReport = ctypes.cdll.LoadLibrary('/usr/lib/libIOReport.dylib')
    CF = ctypes.cdll.LoadLibrary(ctypes.util.find_library('CoreFoundation'))
    CFStringRef = ctypes.c_void_p
    CFDictionaryRef = ctypes.c_void_p
    CFArrayRef = ctypes.c_void_p
    CFIndex = ctypes.c_long

    CF.CFStringCreateWithCString.restype = CFStringRef
    CF.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    CF.CFStringGetCString.restype = ctypes.c_bool
    CF.CFStringGetCString.argtypes = [CFStringRef, ctypes.c_char_p, CFIndex, ctypes.c_uint32]
    CF.CFDictionaryGetValue.restype = ctypes.c_void_p
    CF.CFDictionaryGetValue.argtypes = [CFDictionaryRef, ctypes.c_void_p]
    CF.CFArrayGetCount.restype = CFIndex
    CF.CFArrayGetCount.argtypes = [CFArrayRef]
    CF.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
    CF.CFArrayGetValueAtIndex.argtypes = [CFArrayRef, CFIndex]

    def cf_str(t):
        return CF.CFStringCreateWithCString(None, t.encode('utf-8'), 0x08000100)

    def cf_to_str(c):
        if not c: return ''
        b = ctypes.create_string_buffer(128)
        return b.value.decode('utf-8') if CF.CFStringGetCString(c, b, 128, 0x08000100) else ''

    libIOReport.IOReportCopyChannelsInGroup.restype = CFDictionaryRef
    libIOReport.IOReportCopyChannelsInGroup.argtypes = [CFStringRef, CFStringRef, ctypes.c_uint64, ctypes.c_uint64, ctypes.c_uint64]
    libIOReport.IOReportCreateSubscription.restype = ctypes.c_void_p
    libIOReport.IOReportCreateSubscription.argtypes = [ctypes.c_void_p, CFDictionaryRef, ctypes.POINTER(CFDictionaryRef), ctypes.c_uint64, ctypes.c_void_p]
    libIOReport.IOReportCreateSamples.restype = CFDictionaryRef
    libIOReport.IOReportCreateSamples.argtypes = [ctypes.c_void_p, CFDictionaryRef, ctypes.c_void_p]
    libIOReport.IOReportCreateSamplesDelta.restype = CFDictionaryRef
    libIOReport.IOReportCreateSamplesDelta.argtypes = [CFDictionaryRef, CFDictionaryRef, ctypes.c_void_p]
    libIOReport.IOReportChannelGetChannelName.restype = CFStringRef
    libIOReport.IOReportChannelGetChannelName.argtypes = [CFDictionaryRef]
    libIOReport.IOReportChannelGetUnitLabel.restype = CFStringRef
    libIOReport.IOReportChannelGetUnitLabel.argtypes = [CFDictionaryRef]
    libIOReport.IOReportSimpleGetIntegerValue.restype = ctypes.c_int64
    libIOReport.IOReportSimpleGetIntegerValue.argtypes = [CFDictionaryRef, ctypes.c_int32]

    ch = libIOReport.IOReportCopyChannelsInGroup(cf_str('Energy Model'), None, 0, 0, 0)
    sub_ch = CFDictionaryRef()
    sub = libIOReport.IOReportCreateSubscription(None, ch, ctypes.byref(sub_ch), 0, None)
    s1 = libIOReport.IOReportCreateSamples(sub, sub_ch, None)
    dt = 0.08
    time.sleep(dt)
    s2 = libIOReport.IOReportCreateSamples(sub, sub_ch, None)
    delta = libIOReport.IOReportCreateSamplesDelta(s1, s2, None)
    arr = CF.CFDictionaryGetValue(delta, cf_str('IOReportChannels'))
    cnt = CF.CFArrayGetCount(arr)
    cpu_w = 0.0
    gpu_w = 0.0
    ane_w = 0.0
    for i in range(cnt):
        item = CF.CFArrayGetValueAtIndex(arr, i)
        n = cf_to_str(libIOReport.IOReportChannelGetChannelName(item))
        if n in ('GPU Energy', 'CPU Energy', 'ANE'):
            u = cf_to_str(libIOReport.IOReportChannelGetUnitLabel(item))
            v = libIOReport.IOReportSimpleGetIntegerValue(item, 0)
            sc = 1e9 if u == 'nJ' else (1e6 if u == 'uJ' else 1e3)
            w = round((v / sc) / dt, 2)
            if n == 'CPU Energy': cpu_w = w
            elif n == 'GPU Energy': gpu_w = w
            elif n == 'ANE': ane_w = w
    combined_w = round(cpu_w + gpu_w + ane_w, 2)
    print(json.dumps({'cpuWatts': cpu_w, 'gpuWatts': gpu_w, 'aneWatts': ane_w, 'combinedWatts': combined_w}))
except Exception:
    print('{}')
