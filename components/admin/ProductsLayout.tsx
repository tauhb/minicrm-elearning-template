import React from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { BookOpen, Package } from 'lucide-react'
import CourseList from './CourseList'
import CourseEditor from './CourseEditor'
import DigitalProducts from './DigitalProducts'

const ProductsLayout: React.FC = () => (
  <div className="h-full flex flex-col">
    <div className="border-b border-gray-800 px-8 pt-6 pb-0 bg-gray-950">
      <h1 className="text-2xl font-bold text-white mb-4">Sản phẩm</h1>
      <div className="flex gap-1">
        {[
          { to: '/admin/products/courses', label: 'Khóa học', icon: BookOpen },
          { to: '/admin/products/digital', label: 'Sản phẩm số', icon: Package },
        ].map(tab => (
          <NavLink key={tab.to} to={tab.to}
            className={({ isActive }) => `flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg border-b-2 transition-all ${isActive ? 'border-current' : 'border-transparent text-gray-500 hover:text-white'}`}
            style={({ isActive }: { isActive: boolean }) => isActive ? { color: 'var(--color-mission-accent)', borderColor: 'var(--color-mission-accent)' } : undefined}
          >
            <tab.icon size={14} />{tab.label}
          </NavLink>
        ))}
      </div>
    </div>
    <div className="flex-1 overflow-auto">
      <Routes>
        <Route index element={<Navigate to="courses" replace />} />
        <Route path="courses" element={<CourseList />} />
        <Route path="courses/:courseId" element={<CourseEditor />} />
        <Route path="digital" element={<DigitalProducts />} />
      </Routes>
    </div>
  </div>
)
export default ProductsLayout
