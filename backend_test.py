import requests
import sys
import json
from datetime import datetime, timedelta

class BusManagementTester:
    def __init__(self, base_url="https://bus-management-pro.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.cookies = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, cookies=self.cookies, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, cookies=self.cookies, params=params)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, cookies=self.cookies, params=params)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, cookies=self.cookies, params=params)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json() if response.content else {}
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                self.failed_tests.append(f"{name}: Expected {expected_status}, got {response.status_code}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append(f"{name}: {str(e)}")
            return False, {}

    def test_login(self, email, password):
        """Test login and get token"""
        success, response = self.run_test(
            "Login",
            "POST",
            "auth/login",
            200,
            data={"email": email, "password": password}
        )
        if success and 'token' in response:
            self.token = response['token']
            # Also store cookies for subsequent requests
            login_response = requests.post(f"{self.base_url}/api/auth/login", 
                                        json={"email": email, "password": password})
            if login_response.status_code == 200:
                self.cookies = login_response.cookies
            return True
        return False

    def test_dashboard(self):
        """Test dashboard with filters"""
        # Basic dashboard
        success, data = self.run_test("Dashboard - Basic", "GET", "dashboard", 200)
        if not success:
            return False
            
        # Dashboard with date filter
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        success, _ = self.run_test(
            "Dashboard - Date Filter", 
            "GET", 
            "dashboard", 
            200,
            params={"date_from": week_ago, "date_to": today}
        )
        
        # Dashboard with depot filter
        if success and data and data.get('depots'):
            depot = data['depots'][0] if data['depots'] else ""
            if depot:
                success, _ = self.run_test(
                    "Dashboard - Depot Filter", 
                    "GET", 
                    "dashboard", 
                    200,
                    params={"depot": depot}
                )
        
        return success

    def test_tender_management(self):
        """Test tender CRUD operations"""
        # List tenders
        success, tenders = self.run_test("Tenders - List", "GET", "tenders", 200)
        if not success:
            return False
            
        # Create new tender
        new_tender = {
            "tender_id": f"TEST-{datetime.now().strftime('%H%M%S')}",
            "pk_rate": 90.0,
            "energy_rate": 9.0,
            "subsidy_rate": 6.0,
            "subsidy_type": "per_km",
            "description": "Test tender for automation",
            "status": "active"
        }
        success, created = self.run_test("Tenders - Create", "POST", "tenders", 200, data=new_tender)
        if not success:
            return False
            
        tender_id = created.get('tender_id', new_tender['tender_id'])
        
        # Update tender
        update_data = {**new_tender, "description": "Updated test tender"}
        success, _ = self.run_test(f"Tenders - Update", "PUT", f"tenders/{tender_id}", 200, data=update_data)
        
        # Delete tender (should work since no buses assigned)
        success, _ = self.run_test(f"Tenders - Delete", "DELETE", f"tenders/{tender_id}", 200)
        
        return success

    def test_bus_management(self):
        """Test bus CRUD operations"""
        # List buses
        success, buses = self.run_test("Buses - List", "GET", "buses", 200)
        if not success:
            return False
            
        # Create new bus
        new_bus = {
            "bus_id": f"TEST-{datetime.now().strftime('%H%M%S')}",
            "bus_type": "12m_ac",
            "capacity": 40,
            "tender_id": "",
            "depot": "Test Depot",
            "status": "active"
        }
        success, created = self.run_test("Buses - Create", "POST", "buses", 200, data=new_bus)
        if not success:
            return False
            
        bus_id = created.get('bus_id', new_bus['bus_id'])
        
        # Get bus details
        success, _ = self.run_test(f"Buses - Get Details", "GET", f"buses/{bus_id}", 200)
        
        # Update bus
        update_data = {**new_bus, "capacity": 50}
        success, _ = self.run_test(f"Buses - Update", "PUT", f"buses/{bus_id}", 200, data=update_data)
        
        # Assign tender to bus (if tenders exist)
        success_list, tenders = self.run_test("Get Tenders for Assignment", "GET", "tenders", 200)
        if success_list and tenders:
            tender_id = tenders[0]['tender_id']
            success, _ = self.run_test(
                f"Buses - Assign Tender", 
                "PUT", 
                f"buses/{bus_id}/assign-tender", 
                200,
                params={"tender_id": tender_id}
            )
        
        # Delete bus
        success, _ = self.run_test(f"Buses - Delete", "DELETE", f"buses/{bus_id}", 200)
        
        return success

    def test_driver_management(self):
        """Test driver CRUD operations"""
        # List drivers
        success, drivers = self.run_test("Drivers - List", "GET", "drivers", 200)
        if not success:
            return False
            
        # Create new driver
        new_driver = {
            "name": "Test Driver",
            "license_number": f"TEST-DL-{datetime.now().strftime('%H%M%S')}",
            "phone": "9876543210",
            "bus_id": "",
            "status": "active"
        }
        success, created = self.run_test("Drivers - Create", "POST", "drivers", 200, data=new_driver)
        if not success:
            return False
            
        license_number = created.get('license_number', new_driver['license_number'])
        
        # Update driver
        update_data = {**new_driver, "phone": "9876543211"}
        success, _ = self.run_test(f"Drivers - Update", "PUT", f"drivers/{license_number}", 200, data=update_data)
        
        # Assign bus to driver (if buses exist)
        success_list, buses = self.run_test("Get Buses for Assignment", "GET", "buses", 200)
        if success_list and buses:
            bus_id = buses[0]['bus_id']
            success, _ = self.run_test(
                f"Drivers - Assign Bus", 
                "PUT", 
                f"drivers/{license_number}/assign-bus", 
                200,
                params={"bus_id": bus_id}
            )
        
        # Get driver performance
        success, _ = self.run_test(f"Drivers - Performance", "GET", f"drivers/{license_number}/performance", 200)
        
        # Delete driver
        success, _ = self.run_test(f"Drivers - Delete", "DELETE", f"drivers/{license_number}", 200)
        
        return success

    def test_live_operations(self):
        """Test live operations (mocked data)"""
        # Get live bus positions
        success, live_data = self.run_test("Live Operations - Bus Positions", "GET", "live-operations", 200)
        if not success:
            return False
            
        # Get alerts
        success, alerts = self.run_test("Live Operations - Alerts", "GET", "live-operations/alerts", 200)
        
        return success

    def test_energy_management(self):
        """Test energy management"""
        # List energy data
        success, energy_data = self.run_test("Energy - List", "GET", "energy", 200)
        if not success:
            return False
            
        # Add energy data
        new_energy = {
            "bus_id": "TS-001",  # Using seeded bus
            "date": datetime.now().strftime("%Y-%m-%d"),
            "units_charged": 150.5,
            "tariff_rate": 8.5
        }
        success, _ = self.run_test("Energy - Add", "POST", "energy", 200, data=new_energy)
        
        # Get energy report
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        success, _ = self.run_test(
            "Energy - Report", 
            "GET", 
            "energy/report", 
            200,
            params={"date_from": week_ago, "date_to": today}
        )
        
        return success

    def test_kpi_screen(self):
        """Test KPI screen"""
        # Get KPIs
        success, kpi_data = self.run_test("KPI - Basic", "GET", "kpi", 200)
        if not success:
            return False
            
        # Get KPIs with date filter
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        success, _ = self.run_test(
            "KPI - Date Filter", 
            "GET", 
            "kpi", 
            200,
            params={"date_from": week_ago, "date_to": today}
        )
        
        return success

    def test_deduction_engine(self):
        """Test deduction engine"""
        # List deduction rules
        success, rules = self.run_test("Deductions - List Rules", "GET", "deductions/rules", 200)
        if not success:
            return False
            
        # Create new rule
        new_rule = {
            "name": "Test Rule",
            "rule_type": "performance",
            "penalty_percent": 2.5,
            "is_capped": True,
            "cap_limit": 10000,
            "description": "Test deduction rule",
            "active": True
        }
        success, created = self.run_test("Deductions - Create Rule", "POST", "deductions/rules", 200, data=new_rule)
        if not success:
            return False
            
        rule_id = created.get('id')
        
        # Apply deductions
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        success, _ = self.run_test(
            "Deductions - Apply", 
            "POST", 
            "deductions/apply", 
            200,
            params={"period_start": week_ago, "period_end": today}
        )
        
        # Delete rule
        if rule_id:
            success, _ = self.run_test(f"Deductions - Delete Rule", "DELETE", f"deductions/rules/{rule_id}", 200)
        
        return success

    def test_billing(self):
        """Test billing functionality"""
        # List invoices
        success, invoices = self.run_test("Billing - List", "GET", "billing", 200)
        if not success:
            return False
            
        # Generate invoice
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        invoice_data = {
            "period_start": week_ago,
            "period_end": today,
            "depot": ""
        }
        success, created = self.run_test("Billing - Generate", "POST", "billing/generate", 200, data=invoice_data)
        if not success:
            return False
            
        invoice_id = created.get('invoice_id')
        if invoice_id:
            # Get invoice details
            success, _ = self.run_test(f"Billing - Get Details", "GET", f"billing/{invoice_id}", 200)
            
            # Test export endpoints (these return files, so we expect different handling)
            print(f"\n🔍 Testing Billing - Export PDF...")
            try:
                pdf_url = f"{self.base_url}/api/billing/{invoice_id}/export-pdf"
                pdf_response = requests.get(pdf_url, cookies=self.cookies)
                if pdf_response.status_code == 200 and 'application/pdf' in pdf_response.headers.get('content-type', ''):
                    print(f"✅ Passed - PDF Export working")
                    self.tests_passed += 1
                else:
                    print(f"❌ Failed - PDF Export failed: {pdf_response.status_code}")
                    self.failed_tests.append(f"Billing PDF Export: {pdf_response.status_code}")
                self.tests_run += 1
            except Exception as e:
                print(f"❌ Failed - PDF Export error: {str(e)}")
                self.failed_tests.append(f"Billing PDF Export: {str(e)}")
                self.tests_run += 1
            
            print(f"\n🔍 Testing Billing - Export Excel...")
            try:
                excel_url = f"{self.base_url}/api/billing/{invoice_id}/export-excel"
                excel_response = requests.get(excel_url, cookies=self.cookies)
                if excel_response.status_code == 200 and 'spreadsheet' in excel_response.headers.get('content-type', ''):
                    print(f"✅ Passed - Excel Export working")
                    self.tests_passed += 1
                else:
                    print(f"❌ Failed - Excel Export failed: {excel_response.status_code}")
                    self.failed_tests.append(f"Billing Excel Export: {excel_response.status_code}")
                self.tests_run += 1
            except Exception as e:
                print(f"❌ Failed - Excel Export error: {str(e)}")
                self.failed_tests.append(f"Billing Excel Export: {str(e)}")
                self.tests_run += 1
        
        return success

    def test_reports(self):
        """Test reports functionality"""
        # Test different report types
        report_types = ["operations", "energy", "incidents", "billing"]
        
        for report_type in report_types:
            success, _ = self.run_test(f"Reports - {report_type.title()}", "GET", "reports", 200, 
                                    params={"report_type": report_type})
            if not success:
                return False
        
        # Test report downloads
        today = datetime.now().strftime("%Y-%m-%d")
        week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        
        for fmt in ["excel", "pdf"]:
            print(f"\n🔍 Testing Reports - Download {fmt.upper()}...")
            try:
                download_url = f"{self.base_url}/api/reports/download"
                params = {
                    "report_type": "operations",
                    "date_from": week_ago,
                    "date_to": today,
                    "fmt": fmt
                }
                download_response = requests.get(download_url, cookies=self.cookies, params=params)
                if download_response.status_code == 200:
                    print(f"✅ Passed - {fmt.upper()} Download working")
                    self.tests_passed += 1
                else:
                    print(f"❌ Failed - {fmt.upper()} Download failed: {download_response.status_code}")
                    self.failed_tests.append(f"Reports {fmt.upper()} Download: {download_response.status_code}")
                self.tests_run += 1
            except Exception as e:
                print(f"❌ Failed - {fmt.upper()} Download error: {str(e)}")
                self.failed_tests.append(f"Reports {fmt.upper()} Download: {str(e)}")
                self.tests_run += 1
        
        return True

    def test_incident_management(self):
        """Test incident management"""
        # List incidents
        success, incidents = self.run_test("Incidents - List", "GET", "incidents", 200)
        if not success:
            return False
            
        # Create new incident
        new_incident = {
            "incident_type": "Test Incident",
            "description": "Test incident for automation",
            "bus_id": "TS-001",  # Using seeded bus
            "driver_id": "",
            "severity": "medium"
        }
        success, created = self.run_test("Incidents - Create", "POST", "incidents", 200, data=new_incident)
        if not success:
            return False
            
        incident_id = created.get('id')
        if incident_id:
            # Update incident status
            success, _ = self.run_test(
                f"Incidents - Update Status", 
                "PUT", 
                f"incidents/{incident_id}", 
                200,
                params={"status": "investigating"}
            )
        
        return success

    def test_settings(self):
        """Test settings management"""
        # Get settings
        success, settings = self.run_test("Settings - List", "GET", "settings", 200)
        if not success:
            return False
            
        # Update a setting
        setting_data = {
            "key": "test_setting",
            "value": "test_value"
        }
        success, _ = self.run_test("Settings - Update", "POST", "settings", 200, data=setting_data)
        
        return success

    def test_revenue_details(self):
        """Test new revenue details API endpoints"""
        print("\n📊 Testing Revenue Detail APIs...")
        
        # Test daily revenue details
        success, response = self.run_test(
            "Revenue Details (Daily)",
            "GET",
            "revenue/details",
            200,
            params={"period": "daily"}
        )
        if success:
            data_count = len(response.get('data', []))
            total_revenue = response.get('total_revenue', 0)
            print(f"   Daily records: {data_count}")
            print(f"   Total revenue: Rs.{total_revenue}")
            print(f"   Depots available: {len(response.get('depots', []))}")
        
        # Test monthly aggregation
        success2, _ = self.run_test(
            "Revenue Details (Monthly)",
            "GET",
            "revenue/details",
            200,
            params={"period": "monthly"}
        )
        
        # Test quarterly aggregation
        success3, _ = self.run_test(
            "Revenue Details (Quarterly)",
            "GET",
            "revenue/details",
            200,
            params={"period": "quarterly"}
        )
        
        # Test depot filter
        success4, _ = self.run_test(
            "Revenue Details (Depot Filter)",
            "GET",
            "revenue/details",
            200,
            params={"period": "daily", "depot": "Miyapur Depot"}
        )
        
        return success and success2 and success3 and success4

    def test_km_details(self):
        """Test new KM details API endpoints"""
        print("\n🗺️ Testing KM Detail APIs...")
        
        # Test daily KM details
        success, response = self.run_test(
            "KM Details (Daily)",
            "GET",
            "km/details",
            200,
            params={"period": "daily"}
        )
        if success:
            data_count = len(response.get('data', []))
            total_km = response.get('total_km', 0)
            print(f"   Daily trip records: {data_count}")
            print(f"   Total KM: {total_km}")
            print(f"   Depots available: {len(response.get('depots', []))}")
        
        # Test monthly aggregation
        success2, _ = self.run_test(
            "KM Details (Monthly)",
            "GET",
            "km/details",
            200,
            params={"period": "monthly"}
        )
        
        # Test quarterly aggregation
        success3, _ = self.run_test(
            "KM Details (Quarterly)",
            "GET",
            "km/details",
            200,
            params={"period": "quarterly"}
        )
        
        # Test depot filter
        success4, _ = self.run_test(
            "KM Details (Depot Filter)",
            "GET",
            "km/details",
            200,
            params={"period": "daily", "depot": "Miyapur Depot"}
        )
        
        return success and success2 and success3 and success4

def main():
    print("🚌 Starting Bus Management System API Tests")
    print("=" * 60)
    
    tester = BusManagementTester()
    
    # Test login with admin credentials
    print("\n📋 AUTHENTICATION TESTS")
    if not tester.test_login("admin@tgsrtc.com", "admin123"):
        print("❌ Login failed, stopping tests")
        return 1
    
    # Run all feature tests
    test_modules = [
        ("Dashboard", tester.test_dashboard),
        ("Revenue Details", tester.test_revenue_details),
        ("KM Details", tester.test_km_details),
        ("Tender Management", tester.test_tender_management),
        ("Bus Management", tester.test_bus_management),
        ("Driver Management", tester.test_driver_management),
        ("Live Operations", tester.test_live_operations),
        ("Energy Management", tester.test_energy_management),
        ("KPI Screen", tester.test_kpi_screen),
        ("Deduction Engine", tester.test_deduction_engine),
        ("Billing", tester.test_billing),
        ("Reports", tester.test_reports),
        ("Incident Management", tester.test_incident_management),
        ("Settings", tester.test_settings),
    ]
    
    for module_name, test_func in test_modules:
        print(f"\n📋 {module_name.upper()} TESTS")
        try:
            test_func()
        except Exception as e:
            print(f"❌ {module_name} tests failed with error: {str(e)}")
            tester.failed_tests.append(f"{module_name}: {str(e)}")
    
    # Print final results
    print("\n" + "=" * 60)
    print("📊 FINAL TEST RESULTS")
    print("=" * 60)
    print(f"Tests Run: {tester.tests_run}")
    print(f"Tests Passed: {tester.tests_passed}")
    print(f"Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"Success Rate: {(tester.tests_passed / tester.tests_run * 100):.1f}%")
    
    if tester.failed_tests:
        print(f"\n❌ FAILED TESTS:")
        for failure in tester.failed_tests:
            print(f"   - {failure}")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())