import React, { useState, useEffect } from 'react';
import { Quest, Zone, Task, VideoResource, Resource, TaskType, QuestType, GameSettings, Course } from '../types';
import { Save, Plus, Trash2, ChevronDown, ChevronUp, Copy, FileJson, Play, Layout, List, Video, Link as LinkIcon, CheckSquare, CloudUpload, Share2, Settings, DollarSign, Image, Film } from 'lucide-react';
import { useConfig } from '../contexts/ConfigContext';
import { useDialog } from '../contexts/DialogContext';
import { saveCourseData, updateCourse, fetchCourseLayout, saveCourseLayout } from '../services/api';

interface CourseBuilderProps {
  initialQuests: Quest[];
  initialZones: Zone[];
  onClose: () => void;
  course?: Course | null;
  initialTab?: 'ZONES' | 'QUESTS' | 'SETTINGS';
}

interface CourseFields {
  title: string;
  description: string;
  duration_days: number;
  price: number;
  discount_price: string;
  discount_from: string;
  discount_to: string;
  cover_image_url: string;
  intro_video_url: string;
  status: 'active' | 'draft' | 'archived';
}

export const CourseBuilder: React.FC<CourseBuilderProps> = ({ initialQuests, initialZones, onClose, course, initialTab }) => {
  const { settings: contextSettings, updateSettings } = useConfig();
  const { alert: showAlert, confirm: showConfirm } = useDialog();
  const [quests, setQuests] = useState<Quest[]>(initialQuests);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [localSettings, setLocalSettings] = useState<GameSettings>({
    TITLE: contextSettings?.title || 'MiniCRM',
    DESCRIPTION: contextSettings?.description || '',
    PRIMARY_COLOR: contextSettings?.primaryColor || '#B6FF00',
    LOGO_URL: contextSettings?.logoUrl || '',
    GUIDE_VIDEO_URL: contextSettings?.guideVideoUrl || '',
    SUPPORT_ZALO_LINK: contextSettings?.supportZaloLink || ''
  });

  // Course-level fields (write to courses table)
  const [courseFields, setCourseFields] = useState<CourseFields>({
    title: course?.title || '',
    description: course?.description || '',
    duration_days: course?.duration_days || 35,
    price: course?.price || 0,
    discount_price: course?.discount_price != null ? String(course.discount_price) : '',
    discount_from: course?.discount_from ? course.discount_from.slice(0, 10) : '',
    discount_to: course?.discount_to ? course.discount_to.slice(0, 10) : '',
    cover_image_url: course?.cover_image_url || '',
    intro_video_url: course?.intro_video_url || '',
    status: course?.status || 'draft',
  });
  const [isCourseFieldsSaving, setIsCourseFieldsSaving] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'journey' | 'module'>('journey');
  
  const [activeTab, setActiveTab] = useState<'ZONES' | 'QUESTS' | 'SETTINGS'>(initialTab || 'QUESTS');

  useEffect(() => {
    if (course?.id) fetchCourseLayout(course.id).then(setLayoutMode);
  }, [course?.id]);
  const [selectedQuestId, setSelectedQuestId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // --- ACTIONS ---

  const addZone = () => {
    const newId = zones.length > 0 ? Math.max(...zones.map(z => z.id)) + 1 : 1;
    setZones([...zones, {
      id: newId,
      title: 'Chương Mới',
      description: '',
      startDay: 1,
      endDay: 7,
      color: '#B6FF00'
    }]);
  };

  const updateZone = (id: number, field: keyof Zone, value: any) => {
    setZones(zones.map(z => z.id === id ? { ...z, [field]: value } : z));
  };

  const deleteZone = async (id: number) => {
    const ok = await showConfirm({
      title: 'Xoá chương',
      message: 'Bạn có chắc chắn muốn xoá chương này? Hành động này không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xoá',
    });
    if (ok) setZones(zones.filter(z => z.id !== id));
  };

  const addQuest = () => {
    const newId = quests.length > 0 ? Math.max(...quests.map(q => q.id)) + 1 : 1;
    setQuests([...quests, {
      id: newId,
      title: 'Bài Học Mới',
      description: '',
      zoneId: zones[0]?.id || 1,
      type: QuestType.NORMAL,
      tasks: [],
      videos: [],
      resources: [],
      submissionPlaceholder: ''
    }]);
    setSelectedQuestId(newId);
  };

  const updateQuest = (id: number, field: keyof Quest, value: any) => {
    setQuests(quests.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const deleteQuest = async (id: number) => {
    const ok = await showConfirm({
      title: 'Xoá bài học',
      message: 'Bạn có chắc chắn muốn xoá bài học này? Hành động này không thể hoàn tác.',
      variant: 'danger',
      confirmText: 'Xoá',
    });
    if (ok) {
      setQuests(quests.filter(q => q.id !== id));
      if (selectedQuestId === id) setSelectedQuestId(null);
    }
  };

  const updateSetting = (key: string, value: string) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  // --- SAVE COURSE METADATA (CẤU HÌNH tab) ---

  const handleSaveCourseFields = async () => {
    if (!course?.id) return;
    setIsCourseFieldsSaving(true);
    try {
      await updateCourse(course.id, {
        title: courseFields.title,
        description: courseFields.description || null,
        duration_days: courseFields.duration_days,
        price: courseFields.price,
        discount_price: courseFields.discount_price !== '' ? Number(courseFields.discount_price) : null,
        discount_from: courseFields.discount_from || null,
        discount_to: courseFields.discount_to || null,
        cover_image_url: courseFields.cover_image_url || null,
        intro_video_url: courseFields.intro_video_url || null,
        status: courseFields.status,
      });
      await saveCourseLayout(course.id, layoutMode);
      await updateSettings({
        title: localSettings.TITLE,
        description: localSettings.DESCRIPTION,
        primaryColor: localSettings.PRIMARY_COLOR,
        logoUrl: localSettings.LOGO_URL,
        guideVideoUrl: localSettings.GUIDE_VIDEO_URL,
        supportZaloLink: localSettings.SUPPORT_ZALO_LINK,
      });
      showAlert({ title: 'Đã lưu', message: 'Cấu hình khoá học đã được lưu thành công.', variant: 'success' });
    } catch (e: any) {
      showAlert({ title: 'Lưu thất bại', message: e.message, variant: 'danger' });
    } finally {
      setIsCourseFieldsSaving(false);
    }
  };

  // --- SAVE TO CLOUD (quests/zones) ---

  const handleSave = async () => {
    const ok = await showConfirm({
      title: 'Ghi đè dữ liệu Supabase',
      message: 'Hành động này sẽ ghi đè toàn bộ chương / bài học trên Supabase. Tiếp tục?',
      variant: 'warning',
      confirmText: 'Ghi đè',
    });
    if (!ok) return;

    setIsSaving(true);
    try {
      await saveCourseData(zones, quests, localSettings);
      updateSettings({
        title: localSettings.TITLE,
        description: localSettings.DESCRIPTION,
        primaryColor: localSettings.PRIMARY_COLOR,
        logoUrl: localSettings.LOGO_URL,
        guideVideoUrl: localSettings.GUIDE_VIDEO_URL,
        supportZaloLink: localSettings.SUPPORT_ZALO_LINK
      });
      showAlert({ title: 'Đã lưu', message: 'Dữ liệu đã được lưu lên Supabase.', variant: 'success' });
    } catch (e: any) {
      showAlert({ title: 'Lưu thất bại', message: e.message, variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  // --- SHARE COURSE ---

  const handleShare = () => {
    const shareUrl = window.location.origin;
    navigator.clipboard.writeText(shareUrl);
    showAlert({
      title: 'Đã sao chép',
      message: `Link portal đã được copy vào clipboard.\n${shareUrl}`,
      variant: 'success',
    });
  };

  // --- RENDER HELPERS ---

  const renderSettingsEditor = () => (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* --- THÔNG TIN CƠ BẢN --- */}
      <div className="bg-neutral-900 border border-white/10 p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Settings size={16} className="text-mission-accent" /> Thông Tin Cơ Bản
        </h3>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Tên Khóa Học *</label>
          <input
            value={courseFields.title}
            onChange={e => setCourseFields(p => ({ ...p, title: e.target.value }))}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="VD: MiniCRM 33 ngày"
          />
        </div>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Mô Tả</label>
          <textarea
            value={courseFields.description}
            onChange={e => setCourseFields(p => ({ ...p, description: e.target.value }))}
            rows={3}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none resize-none"
            placeholder="Mô tả ngắn về khóa học..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase mb-1">Số Ngày</label>
            <input
              type="number"
              min={1}
              value={courseFields.duration_days}
              onChange={e => setCourseFields(p => ({ ...p, duration_days: parseInt(e.target.value) || 1 }))}
              className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase mb-1">Trạng Thái</label>
            <select
              value={courseFields.status}
              onChange={e => setCourseFields(p => ({ ...p, status: e.target.value as any }))}
              className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            >
              <option value="draft">Bản nháp</option>
              <option value="active">Đang chạy</option>
              <option value="archived">Lưu trữ</option>
            </select>
          </div>
        </div>
      </div>

      {/* --- GIÁ & ƯU ĐÃI --- */}
      <div className="bg-neutral-900 border border-white/10 p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <DollarSign size={16} className="text-mission-accent" /> Giá & Ưu Đãi
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase mb-1">Giá Gốc (VND)</label>
            <input
              type="number"
              min={0}
              value={courseFields.price}
              onChange={e => setCourseFields(p => ({ ...p, price: parseInt(e.target.value) || 0 }))}
              className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase mb-1">Giá Ưu Đãi (VND)</label>
            <input
              type="number"
              min={0}
              value={courseFields.discount_price}
              onChange={e => setCourseFields(p => ({ ...p, discount_price: e.target.value }))}
              className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
              placeholder="Để trống nếu không có"
            />
          </div>
        </div>

        {courseFields.discount_price !== '' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase mb-1">Ưu Đãi Từ</label>
              <input
                type="date"
                value={courseFields.discount_from}
                onChange={e => setCourseFields(p => ({ ...p, discount_from: e.target.value }))}
                className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase mb-1">Ưu Đãi Đến</label>
              <input
                type="date"
                value={courseFields.discount_to}
                onChange={e => setCourseFields(p => ({ ...p, discount_to: e.target.value }))}
                className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* --- MEDIA --- */}
      <div className="bg-neutral-900 border border-white/10 p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Image size={16} className="text-mission-accent" /> Media
        </h3>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Thumbnail URL</label>
          <input
            value={courseFields.cover_image_url}
            onChange={e => setCourseFields(p => ({ ...p, cover_image_url: e.target.value }))}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="https://..."
          />
          {courseFields.cover_image_url && (
            <img src={courseFields.cover_image_url} alt="preview" className="mt-2 h-28 w-full object-cover rounded-sm opacity-80" />
          )}
        </div>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Video Giới Thiệu (Embed URL)</label>
          <input
            value={courseFields.intro_video_url}
            onChange={e => setCourseFields(p => ({ ...p, intro_video_url: e.target.value }))}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="https://www.youtube.com/embed/..."
          />
        </div>
      </div>

      {/* --- GIAO DIỆN PORTAL --- */}
      <div className="bg-neutral-900 border border-white/10 p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <LinkIcon size={16} className="text-mission-accent" /> Giao Diện & Hỗ Trợ
        </h3>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Màu Chủ Đạo</label>
          <div className="flex gap-3">
            <input
              type="color"
              value={localSettings.PRIMARY_COLOR}
              onChange={e => updateSetting('PRIMARY_COLOR', e.target.value)}
              className="h-10 w-10 bg-transparent border-0 p-0 cursor-pointer"
            />
            <input
              value={localSettings.PRIMARY_COLOR}
              onChange={e => updateSetting('PRIMARY_COLOR', e.target.value)}
              className="flex-1 bg-black border border-white/20 p-3 text-white rounded-sm font-mono uppercase"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Logo URL</label>
          <input
            value={localSettings.LOGO_URL}
            onChange={e => updateSetting('LOGO_URL', e.target.value)}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Video Hướng Dẫn</label>
          <input
            value={localSettings.GUIDE_VIDEO_URL}
            onChange={e => updateSetting('GUIDE_VIDEO_URL', e.target.value)}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="block text-[10px] text-neutral-500 uppercase mb-1">Zalo Hỗ Trợ</label>
          <input
            value={localSettings.SUPPORT_ZALO_LINK}
            onChange={e => updateSetting('SUPPORT_ZALO_LINK', e.target.value)}
            className="w-full bg-black border border-white/20 p-3 text-white rounded-sm focus:border-mission-accent focus:outline-none"
            placeholder="https://zalo.me/..."
          />
        </div>
      </div>

      {/* --- LAYOUT --- */}
      <div className="bg-neutral-900 border border-white/10 p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Layout size={16} className="text-mission-accent" /> Giao Diện Học
        </h3>
        <p className="text-xs text-neutral-500">Chọn cách học viên điều hướng nội dung khoá học.</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { value: 'journey', icon: '🗺️', label: 'Hành Trình', desc: 'Bản đồ nhiệm vụ, mở khoá từng ngày — gamified' },
            { value: 'module',  icon: '📚', label: 'Module',    desc: 'Danh sách bài học theo chương — giống Udemy' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLayoutMode(opt.value)}
              className={`p-4 rounded-sm border text-left transition-all ${
                layoutMode === opt.value
                  ? 'border-mission-accent bg-mission-accent/10'
                  : 'border-white/10 bg-black hover:border-white/20'
              }`}
            >
              <span className="text-2xl block mb-2">{opt.icon}</span>
              <p className={`text-sm font-bold mb-1 ${layoutMode === opt.value ? 'text-mission-accent' : 'text-white'}`}>
                {opt.label}
              </p>
              <p className="text-[11px] text-neutral-500 leading-relaxed">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end pb-6">
        <button
          onClick={handleSaveCourseFields}
          disabled={isCourseFieldsSaving || !course?.id}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-sm disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-mission-accent, #B6FF00)', color: '#000' }}
        >
          <Save size={15} />
          {isCourseFieldsSaving ? 'Đang lưu...' : 'Lưu Cấu Hình'}
        </button>
      </div>
    </div>
  );

  const renderZoneEditor = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white">Chương (Zones)</h3>
        <button onClick={addZone} className="flex items-center gap-2 px-3 py-1.5 bg-mission-accent text-black font-bold rounded-sm text-xs">
          <Plus size={14} /> Thêm Chương
        </button>
      </div>
      <div className="grid gap-4">
        {zones.map(zone => (
          <div key={zone.id} className="bg-neutral-900 border border-white/10 p-4 rounded-sm space-y-3">
            <div className="flex justify-between items-start">
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Tên Chương</label>
                  <input 
                    value={zone.title} 
                    onChange={e => updateZone(zone.id, 'title', e.target.value)}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Màu Sắc (Hex)</label>
                  <div className="flex gap-2">
                    <input 
                      type="color"
                      value={zone.color} 
                      onChange={e => updateZone(zone.id, 'color', e.target.value)}
                      className="h-9 w-9 bg-transparent border-0 p-0 cursor-pointer"
                    />
                    <input 
                      value={zone.color} 
                      onChange={e => updateZone(zone.id, 'color', e.target.value)}
                      className="flex-1 bg-black border border-white/20 p-2 text-sm text-white rounded-sm font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Ngày Bắt Đầu</label>
                  <input 
                    type="number"
                    value={zone.startDay} 
                    onChange={e => updateZone(zone.id, 'startDay', parseInt(e.target.value))}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Ngày Kết Thúc</label>
                  <input 
                    type="number"
                    value={zone.endDay} 
                    onChange={e => updateZone(zone.id, 'endDay', parseInt(e.target.value))}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm"
                  />
                </div>
              </div>
              <button onClick={() => deleteZone(zone.id)} className="text-neutral-500 hover:text-red-500 p-2">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderQuestEditor = () => {
    const activeQuest = quests.find(q => q.id === selectedQuestId);

    return (
      <div className="flex h-full gap-4">
        {/* Quest List Sidebar */}
        <div className="w-64 shrink-0 flex flex-col border-r border-white/10 pr-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-white uppercase">Bài Học</h3>
            <button onClick={addQuest} className="p-1 bg-mission-accent text-black rounded-sm">
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-2">
            {quests.map(q => (
              <button
                key={q.id}
                onClick={() => setSelectedQuestId(q.id)}
                className={`w-full text-left px-3 py-2 text-xs font-mono truncate rounded-sm border ${
                  selectedQuestId === q.id 
                    ? 'bg-mission-accent/10 border-mission-accent text-mission-accent' 
                    : 'bg-transparent border-transparent text-neutral-400 hover:bg-white/5'
                }`}
              >
                Ngày {q.id}: {q.title}
              </button>
            ))}
          </div>
        </div>

        {/* Quest Detail Editor */}
        <div className="flex-1 overflow-y-auto pr-2">
          {activeQuest ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Ngày (ID)</label>
                  <input 
                    type="number"
                    value={activeQuest.id} 
                    onChange={e => updateQuest(activeQuest.id, 'id', parseInt(e.target.value))}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Thuộc Chương</label>
                  <select 
                    value={activeQuest.zoneId}
                    onChange={e => updateQuest(activeQuest.id, 'zoneId', parseInt(e.target.value))}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm"
                  >
                    {zones.map(z => <option key={z.id} value={z.id}>{z.title}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Tiêu Đề Bài Học</label>
                  <input 
                    value={activeQuest.title} 
                    onChange={e => updateQuest(activeQuest.id, 'title', e.target.value)}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm font-bold"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-neutral-500 uppercase mb-1">Mô Tả Nội Dung</label>
                  <textarea 
                    value={activeQuest.description} 
                    onChange={e => updateQuest(activeQuest.id, 'description', e.target.value)}
                    className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded-sm h-24"
                  />
                </div>
              </div>

              {/* Videos Section */}
              <div className="border-t border-white/10 pt-4">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-xs font-bold text-mission-accent uppercase flex items-center gap-2">
                    <Video size={14} /> Video Bài Giảng
                  </h4>
                  <button 
                    onClick={() => {
                      const newVideo: VideoResource = { title: 'Video Mới', url: '', type: 'LESSON' };
                      updateQuest(activeQuest.id, 'videos', [...(activeQuest.videos || []), newVideo]);
                    }}
                    className="text-[10px] px-2 py-1 bg-white/10 hover:bg-white/20 rounded-sm"
                  >
                    + Thêm Video
                  </button>
                </div>
                <div className="space-y-2">
                  {(activeQuest.videos || []).map((vid, idx) => (
                    <div key={idx} className="flex gap-2 items-center bg-neutral-900 p-2 rounded-sm">
                      <input 
                        value={vid.title}
                        onChange={e => {
                          const newVideos = [...(activeQuest.videos || [])];
                          newVideos[idx].title = e.target.value;
                          updateQuest(activeQuest.id, 'videos', newVideos);
                        }}
                        placeholder="Tiêu đề Video"
                        className="flex-1 bg-black border border-white/10 p-1.5 text-xs text-white rounded-sm"
                      />
                      <input 
                        value={vid.url}
                        onChange={e => {
                          const newVideos = [...(activeQuest.videos || [])];
                          newVideos[idx].url = e.target.value;
                          updateQuest(activeQuest.id, 'videos', newVideos);
                        }}
                        placeholder="URL Video (mp4/drive)"
                        className="flex-1 bg-black border border-white/10 p-1.5 text-xs text-white rounded-sm"
                      />
                      <button 
                        onClick={() => {
                          const newVideos = (activeQuest.videos || []).filter((_, i) => i !== idx);
                          updateQuest(activeQuest.id, 'videos', newVideos);
                        }}
                        className="text-neutral-500 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tasks Section */}
              <div className="border-t border-white/10 pt-4">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="text-xs font-bold text-mission-accent uppercase flex items-center gap-2">
                    <CheckSquare size={14} /> Nhiệm Vụ (Checklist)
                  </h4>
                  <button 
                    onClick={() => {
                      const newTask: Task = { id: `t${Date.now()}`, text: 'Nhiệm vụ mới', type: TaskType.MANDATORY };
                      updateQuest(activeQuest.id, 'tasks', [...activeQuest.tasks, newTask]);
                    }}
                    className="text-[10px] px-2 py-1 bg-white/10 hover:bg-white/20 rounded-sm"
                  >
                    + Thêm Nhiệm Vụ
                  </button>
                </div>
                <div className="space-y-2">
                  {activeQuest.tasks.map((task, idx) => (
                    <div key={task.id} className="flex gap-2 items-center bg-neutral-900 p-2 rounded-sm">
                      <select
                        value={task.type}
                        onChange={e => {
                          const newTasks = [...activeQuest.tasks];
                          newTasks[idx].type = e.target.value as TaskType;
                          updateQuest(activeQuest.id, 'tasks', newTasks);
                        }}
                        className="bg-black border border-white/10 p-1.5 text-xs text-white rounded-sm w-24"
                      >
                        <option value={TaskType.MANDATORY}>Bắt buộc</option>
                        <option value={TaskType.OPTIONAL}>Tùy chọn</option>
                      </select>
                      <input 
                        value={task.text}
                        onChange={e => {
                          const newTasks = [...activeQuest.tasks];
                          newTasks[idx].text = e.target.value;
                          updateQuest(activeQuest.id, 'tasks', newTasks);
                        }}
                        className="flex-1 bg-black border border-white/10 p-1.5 text-xs text-white rounded-sm"
                      />
                      <button 
                        onClick={() => {
                          const newTasks = activeQuest.tasks.filter((_, i) => i !== idx);
                          updateQuest(activeQuest.id, 'tasks', newTasks);
                        }}
                        className="text-neutral-500 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button 
                  onClick={() => deleteQuest(activeQuest.id)}
                  className="text-red-500 text-xs flex items-center gap-1 hover:underline"
                >
                  <Trash2 size={12} /> Xóa Bài Học
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-500 text-xs">
              Chọn một bài học để chỉnh sửa
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[20000] bg-black flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-neutral-900">
        <div className="flex items-center gap-4">
          <h2 className="text-white font-bold font-mono uppercase tracking-widest">Xây Dựng Khóa Học</h2>
          <div className="flex bg-black rounded-sm p-1 border border-white/10">
            <button 
              onClick={() => setActiveTab('SETTINGS')}
              className={`px-3 py-1 text-xs font-bold rounded-sm transition-colors ${activeTab === 'SETTINGS' ? 'bg-white/20 text-white' : 'text-neutral-500 hover:text-white'}`}
            >
              CẤU HÌNH
            </button>
            <button 
              onClick={() => setActiveTab('ZONES')}
              className={`px-3 py-1 text-xs font-bold rounded-sm transition-colors ${activeTab === 'ZONES' ? 'bg-white/20 text-white' : 'text-neutral-500 hover:text-white'}`}
            >
              CHƯƠNG
            </button>
            <button 
              onClick={() => setActiveTab('QUESTS')}
              className={`px-3 py-1 text-xs font-bold rounded-sm transition-colors ${activeTab === 'QUESTS' ? 'bg-white/20 text-white' : 'text-neutral-500 hover:text-white'}`}
            >
              BÀI HỌC
            </button>
          </div>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 text-xs font-bold rounded-sm transition-colors flex items-center gap-2 ${isSaving ? 'bg-neutral-800 text-neutral-500' : 'bg-mission-accent text-black hover:bg-[#a3e600]'}`}
          >
            {isSaving ? 'ĐANG LƯU...' : <><CloudUpload size={14} /> LƯU LÊN CLOUD</>}
          </button>
          <button 
            onClick={handleShare}
            className="px-4 py-2 text-xs font-bold rounded-sm transition-colors flex items-center gap-2 bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40 hover:text-white"
          >
            <Share2 size={14} /> CHIA SẺ KHÓA HỌC
          </button>
        </div>
        <button onClick={onClose} className="text-neutral-500 hover:text-white">
          Đóng
        </button>
      </div>

      {/* Body — QUESTS có internal scroll (2 cột), SETTINGS/ZONES cần overflow-y-auto */}
      <div className={`flex-1 p-6 ${activeTab === 'QUESTS' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {activeTab === 'SETTINGS' && renderSettingsEditor()}
        {activeTab === 'ZONES' && renderZoneEditor()}
        {activeTab === 'QUESTS' && renderQuestEditor()}
      </div>
    </div>
  );
};
