const API_BASE = "http://localhost:5001";
let allUsers = []; // 存储所有用户信息

function authRequest(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  return fetch(API_BASE + url, { ...options, headers });
}

// 新增验证码相关变量
let currentCaptchaId = '';
let currentCaptchaData = '';

// 页面加载时初始化验证码
document.addEventListener('DOMContentLoaded', function() {
  const loginPage = document.getElementById('login-page');
  const mainPage = document.getElementById('main-page');
  const adminInfo = localStorage.getItem('admin');
  
  if (adminInfo) {
    loginPage.style.display = 'none';
    mainPage.style.display = '';
    showMain();
  } else {
    refreshCaptcha();
    
    // 添加验证码点击刷新功能
    const captchaImage = document.getElementById('captcha-image');
    if (captchaImage) {
      captchaImage.addEventListener('click', refreshCaptcha);
    }
  }
});

// 专门用于刷新验证码的函数
function refreshCaptcha() {
  fetch(API_BASE + '/captcha')
    .then(response => {
      if (!response.ok) {
        throw new Error('获取验证码失败');
      }
      return response.json();
    })
    .then(data => {
      currentCaptchaId = data.captcha_id;
      document.getElementById('captcha-image').src = data.image_data;
      document.getElementById('login-error').innerText = '';
      document.getElementById('login-captcha').value = '';
    })
    .catch(error => {
      console.error('验证码加载失败:', error);
      document.getElementById('login-error').innerText = '验证码加载失败，点击重试';
    });
}


// ========== 登录逻辑 ==========
// 修改登录函数
function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const captcha = document.getElementById('login-captcha').value.trim();
  
  if (!username || !password || !captcha) {
    document.getElementById('login-error').innerText = '请填写完整信息';
    return;
  }
  
  authRequest('/admin_login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employee_id: username,
      password: password,
      captcha: captcha,
      captcha_id: currentCaptchaId
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      localStorage.setItem('admin', JSON.stringify(data.user));
      localStorage.setItem('token', data.token);
      showMain();
    } else {
      document.getElementById('login-error').innerText = data.error || '登录失败';
      refreshCaptcha(); // 刷新验证码
      document.getElementById('login-captcha').value = ''; // 清空验证码输入框
    }
  })
  .catch(() => {
    document.getElementById('login-error').innerText = '网络错误';
    refreshCaptcha(); // 刷新验证码
  });
}

function showMain() {
  // 安全访问元素
  const loginPage = document.getElementById('login-page');
  const mainPage = document.getElementById('main-page');
  
  if (loginPage) loginPage.style.display = 'none';
  if (mainPage) mainPage.style.display = '';
  
  const admin = JSON.parse(localStorage.getItem('admin'));
  
  // 安全访问 admin-info 元素
  const adminInfo = document.getElementById('admin-info');
  if (adminInfo) {
    adminInfo.innerText = admin ? `欢迎，${admin.full_name}（${admin.role}）` : '';
  }
  
  showPanel('traffic');
}

function logout() {
  localStorage.removeItem('admin');
  localStorage.removeItem('token');
  location.reload();
}

// ========== 面板切换 ==========
function showPanel(panel) {
  // 安全处理面板元素
  document.querySelectorAll('.panel').forEach(p => {
    if (p) p.style.display = 'none';
  });
  
  const targetPanel = document.getElementById('panel-' + panel);
  if (targetPanel) targetPanel.style.display = '';
  
  if (panel === 'traffic') loadTraffic();
  if (panel === 'flow') loadFlow();
  if (panel === 'accident') loadAccidents();
  if (panel === 'user') loadUsers();
  if (panel === 'operator') loadOperators();
}

// ========== 红绿灯管理 ==========
let trafficData = [];
let editIndex = -1;
let editRowCache = null;

function loadTraffic() {
  authRequest('/admin/traffic_lights')
    .then(res => res.json())
    .then(data => {
      trafficData = data;
      const tbody = document.querySelector('#traffic-table tbody');
      
      // 安全处理表格主体
      if (tbody) {
        tbody.innerHTML = '';
        trafficData.forEach((row, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${row.intersection_id}</td>
            <td>${row.light_id}</td>
            <td>${row.red_duration}</td>
            <td>${row.green_duration}</td>
            <td>${row.current_status === 'red' ? '红灯' : '绿灯'}</td>
            <td><button onclick="editTraffic(${idx})">编辑</button></td>
          `;
          tbody.appendChild(tr);
        });
      }
    });
}

function editTraffic(idx) {
  editIndex = idx;
  editRowCache = { ...trafficData[idx] };
  
  // 安全访问编辑元素
  const editRed = document.getElementById('edit-red');
  const editGreen = document.getElementById('edit-green');
  const editStatus = document.getElementById('edit-status');
  const trafficEdit = document.getElementById('traffic-edit');
  
  if (editRed) editRed.value = editRowCache.red_duration;
  if (editGreen) editGreen.value = editRowCache.green_duration;
  if (editStatus) editStatus.value = editRowCache.current_status;
  if (trafficEdit) trafficEdit.style.display = '';
}

function saveTrafficEdit() {
  if (editIndex < 0) return;
  
  const row = trafficData[editIndex];
  const newRed = parseInt(document.getElementById('edit-red').value) || row.red_duration;
  const newGreen = parseInt(document.getElementById('edit-green').value) || row.green_duration;
  const newStatus = document.getElementById('edit-status').value || row.current_status;
  
  authRequest( '/admin/traffic_lights', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intersection_id: row.intersection_id,
      light_id: row.light_id,
      red_duration: newRed,
      green_duration: newGreen,
      current_status: newStatus
    })
  })
  .then(res => {
    if (!res.ok) throw new Error('保存失败');
    return res.json();
  })
  .then(data => {
    if (data.status === 'success') {
      closeTrafficEdit();
      loadTraffic();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  })
  .catch(error => {
    console.error('保存错误:', error);
    alert('保存失败，请重试');
  });
}

function closeTrafficEdit() {
  const trafficEdit = document.getElementById('traffic-edit');
  if (trafficEdit) trafficEdit.style.display = 'none';
}

// ========== 车流量 ==========
function loadFlow() {
  const intersection = document.getElementById('flow-intersection').value || '1';
  const date = document.getElementById('flow-date').value || '';
  
  let url =  `/admin/traffic_flow?intersection_id=${intersection}`;
  if (date) url += `&date=${date}`;
  
  authRequest(url)
    .then(res => res.json())
    .then(flowData => {
      const tbody = document.querySelector('#flow-table tbody');
      if (tbody) {
        tbody.innerHTML = '';
        flowData.forEach(row => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${row.record_date || ''}</td><td>${row.record_hour || ''}</td><td>${row.time_period || ''}</td><td>${row.flow_count || ''}</td>`;
          tbody.appendChild(tr);
        });
      }
    })
    .catch(error => {
      console.error('加载车流量错误:', error);
      alert('加载车流量失败');
    });
}


// ========== 事故记录 ==========
function loadAccidents() {
  const intersection = document.getElementById('accident-intersection').value;
  let url = `/admin/accidents?intersection_id=${intersection}`;
  authRequest(url)
    .then(res => res.json())
    .then(accidentData => {
      const tbody = document.querySelector('#accident-table tbody');
      tbody.innerHTML = '';
      accidentData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.date || ''}</td><td>${row.description || ''}</td>`;
        tbody.appendChild(tr);
      });
    });
}

// ========== 用户管理 ==========
function loadUsers() {
  authRequest('/admin/users')
    .then(res => res.json())
    .then(userData => {
      allUsers = userData; // 保存所有用户数据
      const tbody = document.querySelector('#user-table tbody');
      tbody.innerHTML = '';
      
      // 填充用户下拉选择框
      const userSelect = document.getElementById('reset-user-select');
      userSelect.innerHTML = '';
      userData.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.username} (${user.email})`;
        userSelect.appendChild(option);
      });
      
      // 填充用户表格
      userData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.username || ''}</td>
          <td>${row.email || ''}</td>
          <td>${row.phone || ''}</td>
          <td>${row.has_password ? '********' : '未设置'}</td>
          <td>${row.role || ''}</td>
          <td>${row.created_at || ''}</td>
          <td>
            <button onclick="deleteUser(${row.id}, '${row.role || ''}')">删除</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    });
}

// 重置密码功能
function showResetPasswordDialog() {
  document.getElementById('reset-password-modal').style.display = '';
  document.getElementById('reset-password').value = '';
}

function closeResetPasswordModal() {
  document.getElementById('reset-password-modal').style.display = 'none';
}

function submitPasswordReset() {
  const userId = document.getElementById('reset-user-select').value;
  const newPassword = document.getElementById('reset-password').value.trim();
  
  if (!newPassword) {
    alert('请输入新密码');
    return;
  }
  
  authRequest('/admin/users/reset_password', {
    method: 'POST',
    body: JSON.stringify({ id: userId, new_password: newPassword })
  })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        alert('密码重置成功');
        closeResetPasswordModal();
        loadUsers(); // 刷新用户列表
      } else {
        alert(data.error || '密码重置失败');
      }
    })
    .catch(() => {
      alert('网络错误');
    });
}

function deleteUser(userId, role) {
  if (role === 'admin') {
    alert('不能删除管理员用户');
    return;
  }
  if (!confirm('确定要删除该用户吗？')) return;
  authRequest(`/admin/users/${userId}`, {
    method: 'DELETE'
  })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        loadUsers();
      } else {
        alert(data.error || '删除失败');
      }
    });
}
// ========== 工作人员管理 ==========
// ========== 工作人员管理 ==========
let operatorData = [];
let operatorEditMode = 'add'; // 'add' or 'edit'
let operatorEditId = null;

function loadOperators() {
  authRequest('/admin/operators')
    .then(res => res.json())
    .then(data => {
      operatorData = data;
      const tbody = document.querySelector('#operator-table tbody');
      
      // 安全处理操作员表格
      if (tbody) {
        tbody.innerHTML = '';
        operatorData.forEach((row, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${row.employee_id}</td>
            <td>${row.full_name}</td>
            <td>${row.status === 'active' ? '在职' : '停用'}</td>
            <td>
              <button onclick="editOperator(${idx})">编辑</button>
              <button onclick="deleteOperator('${row.employee_id}')">删除</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    })
    .catch(error => {
      console.error('加载操作员错误:', error);
      alert('加载操作员失败');
    });
}


function showAddOperator() {
  operatorEditMode = 'add';
  operatorEditId = null;
  document.getElementById('operator-edit-title').innerText = '新增工作人员';
  document.getElementById('op-employee-id').value = '';
  document.getElementById('op-employee-id').disabled = false;
  document.getElementById('op-full-name').value = '';
  document.getElementById('op-password').value = '';
  document.getElementById('op-status').value = 'active';
  document.getElementById('operator-edit').style.display = '';
}

function editOperator(idx) {
  operatorEditMode = 'edit';
  const row = operatorData[idx];
  operatorEditId = row.employee_id;
  document.getElementById('operator-edit-title').innerText = '编辑工作人员';
  document.getElementById('op-employee-id').value = row.employee_id;
  document.getElementById('op-employee-id').disabled = true;
  document.getElementById('op-full-name').value = row.full_name;
  document.getElementById('op-password').value = '';
  document.getElementById('op-status').value = row.status;
  document.getElementById('operator-edit').style.display = '';
}

function saveOperatorEdit() {
  const employee_id = document.getElementById('op-employee-id').value.trim();
  const full_name = document.getElementById('op-full-name').value.trim();
  const password = document.getElementById('op-password').value.trim();
  const status = document.getElementById('op-status').value;
  if (!employee_id || !full_name || (operatorEditMode === 'add' && !password)) {
    alert('请填写完整信息');
    return;
  }
  if (operatorEditMode === 'add') {
    authRequest('/admin/operators', {
      method: 'POST',
      body: JSON.stringify({ employee_id, full_name, password, status })
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          closeOperatorEdit();
          loadOperators();
        } else {
          alert(data.error || '新增失败');
        }
      });
  } else {
    // 编辑
    const updateData = { full_name, status };
    if (password) updateData.password = password;
    authRequest(`/admin/operators/${employee_id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          closeOperatorEdit();
          loadOperators();
        } else {
          alert(data.error || '修改失败');
        }
      });
  }
}

function deleteOperator(employee_id) {
  if (!confirm('确定要删除该工作人员吗？')) return;
  authRequest(`/admin/operators/${employee_id}`, {
    method: 'DELETE'
  })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        loadOperators();
      } else {
        alert(data.error || '删除失败');
      }
    });
}

function closeOperatorEdit() {
  document.getElementById('operator-edit').style.display = 'none';
}

// 在showPanel中加一行
// if (panel === 'operator') loadOperators();